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

interface SmallTarget {
  screen: string;
  what: string;
  width: number;
  height: number;
}

/**
 * Everything on screen that a finger can press, measured: its box must be at least 44 px tall
 * and 44 px wide. (For a while the width asked was 40: six speed buttons beside the play button
 * do not fit a 390-px screen at 44. They have a row of their own on a phone now, and the rule
 * is the charter's.) Links inside a sentence are exempt, as they are in the guideline. Only
 * elements that are really pressable where they stand are counted: on screen and not covered.
 */
/** The narrowest and the shortest target met on any screen, so that the report says how close to the rule the product is. */
const least = { width: Number.POSITIVE_INFINITY, narrowest: "", height: Number.POSITIVE_INFINITY, shortest: "" };

async function measureTargets(page: Page, screen: string, small: SmallTarget[]): Promise<number> {
  const found = await page.evaluate(() => {
    const out: { what: string; width: number; height: number }[] = [];
    let counted = 0;
    const least = { width: Number.POSITIVE_INFINITY, narrowest: "", height: Number.POSITIVE_INFINITY, shortest: "" };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type="hidden"]), [role="button"], [role="radio"], [role="tab"]'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") continue;
      if ((el as HTMLButtonElement).disabled) continue;
      if (el.tagName === "A" && style.display === "inline") continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      const top = document.elementFromPoint(cx, cy);
      if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
      counted++;
      // a control inside a label is pressed through the label: the label's box is the target
      const label = el.closest("label");
      const box = label ? label.getBoundingClientRect() : r;
      const name = el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 40);
      if (box.width < least.width) {
        least.width = Math.round(box.width * 10) / 10;
        least.narrowest = name;
      }
      if (box.height < least.height) {
        least.height = Math.round(box.height * 10) / 10;
        least.shortest = name;
      }
      if (box.height < 43.5 || box.width < 43.5) out.push({ what: el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 40), width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 });
    }
    return { out, counted, least };
  });
  for (const t of found.out) small.push({ screen, ...t });
  if (found.least.width < least.width) {
    least.width = found.least.width;
    least.narrowest = `${found.least.narrowest} (${screen})`;
  }
  if (found.least.height < least.height) {
    least.height = found.least.height;
    least.shortest = `${found.least.shortest} (${screen})`;
  }
  return found.counted;
}

async function scan(page: Page, screen: string, findings: Finding[], incomplete: Record<string, number>, small?: SmallTarget[], counts?: Record<string, number>): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const v of results.violations) findings.push({ screen, id: v.id, impact: v.impact ?? "unknown", help: v.help, nodes: v.nodes.length, sample: (v.nodes[0]?.html ?? "").slice(0, 160) });
  for (const v of results.incomplete) incomplete[`${screen}: ${v.id}`] = v.nodes.length;
  if (small && counts) counts[screen] = await measureTargets(page, screen, small);
}

test("no serious or critical accessibility violations on any screen or panel", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  const project = testInfo.project.name;
  const phone = project === "mobile";
  const findings: Finding[] = [];
  const incomplete: Record<string, number> = {};
  // on the phone project every pressable thing on every scanned screen is measured as well
  const small: SmallTarget[] | undefined = phone ? [] : undefined;
  const targetCounts: Record<string, number> | undefined = phone ? {} : undefined;

  await page.goto("/?q=low&pr=0.6");
  await expect(page.getByTestId("title")).toBeVisible();
  await scan(page, "title", findings, incomplete, small, targetCounts);

  await page.getByTestId("title-recordings").click();
  await expect(page.getByTestId("recordings")).toBeVisible();
  await scan(page, "recordings", findings, incomplete, small, targetCounts);
  await page.getByTestId("recordings-close").click();

  await page.getByTestId("begin").click();
  await expect(page.getByTestId("setup")).toBeVisible();
  await scan(page, "setup", findings, incomplete, small, targetCounts);
  await page.getByTestId("scenario-first_light").click();
  await page.getByTestId("seed-input").fill("7");
  await page.getByTestId("create-world").click();
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 7", { timeout: 60_000 });
  await scan(page, "world with first steps", findings, incomplete, small, targetCounts);
  await page.getByTestId("coach-skip").click();

  // some history, so that panels have content to check
  await page.getByTestId("speed-5").click();
  await page.getByTestId("play-toggle").click();
  await expect.poll(async () => Number(((await page.getByTestId("tick").textContent()) ?? "").replace(/\D+/g, "")), { timeout: 240_000 }).toBeGreaterThan(200);
  await page.getByTestId("play-toggle").click();
  await scan(page, "world", findings, incomplete, small, targetCounts);

  await page.getByTestId("open-chronicle").click();
  await expect(page.getByTestId("chronicle")).toBeVisible();
  await scan(page, "chronicle", findings, incomplete, small, targetCounts);
  await page.getByTestId("chronicle-close").click();

  for (const [open, panel, close] of [
    ["open-interventions", "interventions", "interventions-close"],
    ["open-civics", "civics", "civics-close"],
    ["open-atlas", "atlas", "atlas-close"],
    ["open-menu", "menu", "menu-close"],
  ] as const) {
    await page.getByTestId(open).click();
    await expect(page.getByTestId(panel)).toBeVisible();
    await scan(page, panel, findings, incomplete, small, targetCounts);
    await page.getByTestId(close).click();
    await expect(page.getByTestId(panel)).toHaveCount(0);
  }

  // history, with a morning chosen so that the three ways of going back are on screen
  await page.getByTestId("open-history").click();
  await expect(page.getByTestId("history")).toBeVisible();
  await page.getByTestId("moment-0").click();
  await expect(page.getByTestId("rewind-branch")).toBeVisible();
  await scan(page, "history", findings, incomplete, small, targetCounts);
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
  await scan(page, "compare", findings, incomplete, small, targetCounts);
  await page.getByTestId("compare-close").click();
  await page.getByTestId("view-twin").click();
  await expect(page.getByTestId("twin-badge")).toBeVisible();
  await scan(page, "the twin on screen", findings, incomplete, small, targetCounts);
  await page.getByTestId("twin-back").click();
  await expect(page.getByTestId("twin-badge")).toHaveCount(0);

  await page.getByTestId("open-menu").click();
  await page.getByTestId("menu-journal").click();
  await expect(page.getByTestId("journal")).toBeVisible();
  await scan(page, "journal", findings, incomplete, small, targetCounts);
  await page.getByTestId("journal-close").click();

  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-affordances").click();
  await expect(page.getByTestId("affordances")).toBeVisible();
  await scan(page, "what was designed", findings, incomplete, small, targetCounts);
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
  await scan(page, "inspector", findings, incomplete, small, targetCounts);

  // the laboratory is a page of its own: a published bundle with its charts and tables
  await page.goto("/lab");
  await expect(page.getByTestId("bundle-summary")).toBeVisible();
  await expect(page.getByTestId("verify")).toBeVisible();
  await scan(page, "laboratory", findings, incomplete, small, targetCounts);

  const report = { project, rules: "axe-core, tags wcag2a wcag2aa wcag21a wcag21aa", screens: 17, violations: findings, couldNotDecide: incomplete, ...(small && targetCounts ? { touchTargets: { rule: "at least 44 px tall and 44 px wide; links inside sentences exempt", measured: targetCounts, narrowest: { px: least.width, what: least.narrowest }, shortest: { px: least.height, what: least.shortest }, tooSmall: small } } : {}) };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `a11y-${project}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("a11y", { body: JSON.stringify(report, null, 2), contentType: "application/json" });

  if (small) expect(small, `targets too small for a finger:\n${small.map((t) => `  [${t.screen}] ${t.what}: ${t.width} × ${t.height}`).join("\n")}`).toEqual([]);
  const blocking = findings.filter((f) => f.impact === "serious" || f.impact === "critical");
  expect(blocking, `accessibility violations:\n${blocking.map((f) => `  [${f.screen}] ${f.id} (${f.impact}, ${f.nodes} nodes): ${f.help} — ${f.sample}`).join("\n")}`).toEqual([]);
});
