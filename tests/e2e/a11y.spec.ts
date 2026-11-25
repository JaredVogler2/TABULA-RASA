import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Automated accessibility checks (axe-core, WCAG 2.0/2.1 A and AA rules) on every screen and
 * panel of the game, in the state a player actually reaches them.
 *
 * What this does and does not show: axe finds what a machine can find — missing names, bad
 * roles, contrast it can compute, focus traps it can detect. It cannot hear a screen reader
 * or judge whether the game is usable without sight; nobody has tested that, and the docs say so.
 * The 3D world itself is one labelled canvas: its contents are reachable through the panels.
 */
const OUT = process.env.E2E_SHOTS ?? "test-results/shots";

interface Finding {
  screen: string;
  id: string;
  impact: string;
  help: string;
  nodes: number;
  sample: string;
}

async function scan(page: Page, screen: string, findings: Finding[], incomplete: Record<string, number>): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const v of results.violations) findings.push({ screen, id: v.id, impact: v.impact ?? "unknown", help: v.help, nodes: v.nodes.length, sample: (v.nodes[0]?.html ?? "").slice(0, 160) });
  for (const v of results.incomplete) incomplete[`${screen}: ${v.id}`] = v.nodes.length;
}

test("no serious or critical accessibility violations on any screen or panel", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  const project = testInfo.project.name;
  const phone = project === "mobile";
  const findings: Finding[] = [];
  const incomplete: Record<string, number> = {};

  await page.goto("/?q=low&pr=0.6");
  await expect(page.getByTestId("title")).toBeVisible();
  await scan(page, "title", findings, incomplete);

  await page.getByTestId("title-recordings").click();
  await expect(page.getByTestId("recordings")).toBeVisible();
  await scan(page, "recordings", findings, incomplete);
  await page.getByTestId("recordings-close").click();

  await page.getByTestId("begin").click();
  await expect(page.getByTestId("setup")).toBeVisible();
  await scan(page, "setup", findings, incomplete);
  await page.getByTestId("scenario-first_light").click();
  await page.getByTestId("seed-input").fill("7");
  await page.getByTestId("create-world").click();
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 7", { timeout: 60_000 });
  await scan(page, "world with first steps", findings, incomplete);
  await page.getByTestId("coach-skip").click();

  // some history, so that panels have content to check
  await page.getByTestId("speed-5").click();
  await page.getByTestId("play-toggle").click();
  await expect.poll(async () => Number(((await page.getByTestId("tick").textContent()) ?? "").replace(/\D+/g, "")), { timeout: 240_000 }).toBeGreaterThan(200);
  await page.getByTestId("play-toggle").click();
  await scan(page, "world", findings, incomplete);

  await page.getByTestId("open-chronicle").click();
  await expect(page.getByTestId("chronicle")).toBeVisible();
  await scan(page, "chronicle", findings, incomplete);
  await page.getByTestId("chronicle-close").click();

  for (const [open, panel, close] of [
    ["open-interventions", "interventions", "interventions-close"],
    ["open-civics", "civics", "civics-close"],
    ["open-atlas", "atlas", "atlas-close"],
    ["open-menu", "menu", "menu-close"],
  ] as const) {
    await page.getByTestId(open).click();
    await expect(page.getByTestId(panel)).toBeVisible();
    await scan(page, panel, findings, incomplete);
    await page.getByTestId(close).click();
    await expect(page.getByTestId(panel)).toHaveCount(0);
  }

  // history, with a morning chosen so that the three ways of going back are on screen
  await page.getByTestId("open-history").click();
  await expect(page.getByTestId("history")).toBeVisible();
  await page.getByTestId("moment-0").click();
  await expect(page.getByTestId("rewind-branch")).toBeVisible();
  await scan(page, "history", findings, incomplete);
  await page.getByTestId("history-close").click();
  await expect(page.getByTestId("history")).toHaveCount(0);

  // a change to the world, so that there is a twin: the comparison with its tables open, then the twin on screen
  await page.getByTestId("open-interventions").click();
  await page.getByTestId("intervene-blight").click();
  await expect(page.getByTestId("forked-badge")).toBeVisible();
  await page.getByTestId("open-compare").click();
  await expect(page.getByTestId("compare-table")).toBeVisible();
  await expect(page.getByTestId("happened-table")).toBeVisible();
  await page.getByTestId("toggle-series-table").click();
  await expect(page.getByTestId("series-table")).toBeVisible();
  await scan(page, "compare", findings, incomplete);
  await page.getByTestId("compare-close").click();
  await page.getByTestId("view-twin").click();
  await expect(page.getByTestId("twin-badge")).toBeVisible();
  await scan(page, "the twin on screen", findings, incomplete);
  await page.getByTestId("twin-back").click();
  await expect(page.getByTestId("twin-badge")).toHaveCount(0);

  await page.getByTestId("open-menu").click();
  await page.getByTestId("menu-journal").click();
  await expect(page.getByTestId("journal")).toBeVisible();
  await scan(page, "journal", findings, incomplete);
  await page.getByTestId("journal-close").click();

  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-affordances").click();
  await expect(page.getByTestId("affordances")).toBeVisible();
  await scan(page, "what was designed", findings, incomplete);
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("affordances")).toHaveCount(0);

  // a citizen's inspector, with one of the views of what they know switched on
  for (let attempt = 0; attempt < 12 && (await page.getByTestId("inspector-name").count()) === 0; attempt++) {
    const p = await page.evaluate(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let id = 0; id < 50; id++) {
        const s = window.__tr?.screenOf(id);
        if (s && s.x > w * 0.12 && s.x < w * 0.88 && s.y > h * 0.3 && s.y < h * 0.7) return s;
      }
      return null;
    });
    if (p) {
      if (phone) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    }
    await page.waitForTimeout(400);
  }
  await expect(page.getByTestId("inspector-name")).toBeVisible();
  await page.getByTestId("overlay-knowledge").click();
  await scan(page, "inspector", findings, incomplete);

  // the laboratory is a page of its own: a published bundle with its charts and tables
  await page.goto("/lab");
  await expect(page.getByTestId("bundle-summary")).toBeVisible();
  await expect(page.getByTestId("verify")).toBeVisible();
  await scan(page, "laboratory", findings, incomplete);

  const report = { project, rules: "axe-core, tags wcag2a wcag2aa wcag21a wcag21aa", screens: 17, violations: findings, couldNotDecide: incomplete };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `a11y-${project}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("a11y", { body: JSON.stringify(report, null, 2), contentType: "application/json" });

  const blocking = findings.filter((f) => f.impact === "serious" || f.impact === "critical");
  expect(blocking, `accessibility violations:\n${blocking.map((f) => `  [${f.screen}] ${f.id} (${f.impact}, ${f.nodes} nodes): ${f.help} — ${f.sample}`).join("\n")}`).toEqual([]);
});
