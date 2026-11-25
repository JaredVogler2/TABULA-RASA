import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 04 gate: the complete offline loop with real clicks and taps.
 *
 *   title → scenario & seed → world → play / pause / step / speed → inspect a citizen →
 *   read the Chronicle → intervene (fork) → compare → save → reload → continue
 *
 * Runs against the production build with zero credentials. `?q=low` selects the low
 * graphics preset because CI renders WebGL in software; it changes drawing only.
 */

const SHOTS = process.env.E2E_SHOTS ?? "evidence/phase-04/e2e";

async function shot(page: Page, project: string, name: string): Promise<void> {
  mkdirSync(join(SHOTS, project), { recursive: true });
  // JPEG keeps the committed evidence small; the test asserts on the DOM, never on pixels
  await page.screenshot({ path: join(SHOTS, project, `${name}.jpg`), type: "jpeg", quality: 84 });
}

async function tick(page: Page): Promise<number> {
  const text = (await page.getByTestId("tick").textContent()) ?? "";
  return Number(text.replace(/\D+/g, ""));
}

/** Click (or tap) a living citizen in the 3D world at its real on-screen position. */
async function clickCitizen(page: Page, touch: boolean): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const target = await page.evaluate(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let id = 0; id < 50; id++) {
        const p = window.__tr?.screenOf(id);
        // stay clear of the HUD at the edges of the screen
        if (p && p.x > w * 0.12 && p.x < w * 0.88 && p.y > h * 0.26 && p.y < h * 0.72) return p;
      }
      return null;
    });
    if (target) {
      if (touch) await page.touchscreen.tap(target.x, target.y);
      else await page.mouse.click(target.x, target.y);
      try {
        await expect(page.getByTestId("inspector-name")).toBeVisible({ timeout: 4000 });
        return;
      } catch {
        // the citizen moved between the probe and the click: try again
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error("could not select a citizen by clicking the world");
}

test("a new player can complete the whole loop offline", async ({ page }, testInfo) => {
  // CI draws WebGL on the CPU (SwiftShader), where every frame costs hundreds of milliseconds
  test.setTimeout(420_000);
  const project = testInfo.project.name;
  const touch = project === "mobile";
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  const failed: string[] = [];
  page.on("requestfailed", (req) => failed.push(`${req.method()} ${req.url()}`));
  const external: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.protocol !== "data:" && url.protocol !== "blob:") external.push(req.url());
  });

  // ── title: a live world behind the wordmark
  await page.goto("/?q=low&pr=0.6");
  await expect(page.getByTestId("title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tabula Rasa" })).toBeVisible();
  await page.waitForFunction(() => (window.__tr?.stats() as { drawCalls?: number } | null)?.drawCalls !== undefined);
  await page.waitForTimeout(1500);
  await shot(page, project, "01-title");

  // ── scenario and seed
  await page.getByTestId("begin").click();
  await expect(page.getByTestId("setup")).toBeVisible();
  await page.getByTestId("scenario-first_light").click();
  await page.getByTestId("seed-input").fill("7");
  await page.getByTestId("policy-select").selectOption("reflex");
  await shot(page, project, "02-setup");
  await page.getByTestId("create-world").click();

  // ── the world at tick 0
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 7", { timeout: 60_000 });
  await expect(page.getByTestId("stat-population")).toContainText("50");
  expect(await tick(page)).toBe(0);
  await expect(page.getByTestId("coach")).toContainText("Press play");
  await page.waitForTimeout(1200);
  await shot(page, project, "03-world-start");

  // ── step, play, speed, pause
  await page.getByTestId("step-tick").click();
  await expect.poll(() => tick(page)).toBe(1);
  await page.getByTestId("step-tick").click();
  await expect.poll(() => tick(page)).toBe(2);
  await page.getByTestId("speed-3").click();
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "true");
  await expect.poll(() => tick(page), { timeout: 90_000 }).toBeGreaterThan(130);
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
  const paused = await tick(page);
  await page.waitForTimeout(700);
  expect(await tick(page)).toBe(paused); // paused means paused
  await shot(page, project, "04-world-evolved");

  // ── inspect a citizen by clicking it in the world
  await clickCitizen(page, touch);
  const name = (await page.getByTestId("inspector-name").textContent()) ?? "";
  expect(name.length).toBeGreaterThan(2);
  await expect(page.getByTestId("inspector-goal")).not.toBeEmpty();
  await expect(page.getByTestId("inspector-body")).toContainText("BASELINE");
  await expect(page.getByTestId("inspector-body")).toContainText("believes");
  await page.getByTestId("follow").click();
  await expect(page.getByTestId("follow")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(900);
  await shot(page, project, "05-inspect-citizen");
  await page.getByTestId("inspector-close").click();
  await expect(page.getByTestId("inspector")).toHaveCount(0);

  // ── the Chronicle lists logged events; an entry jumps to where it happened
  await page.getByTestId("open-chronicle").click();
  await expect(page.getByTestId("chronicle")).toBeVisible();
  const entries = page.getByTestId("chronicle-entries").locator("li");
  expect(await entries.count()).toBeGreaterThan(0);
  await shot(page, project, "06-chronicle");
  await entries.first().locator("button").click();
  await page.getByTestId("chronicle-close").click();
  if (await page.getByTestId("inspector-close").count()) await page.getByTestId("inspector-close").click();

  // ── intervene: history forks
  await page.getByTestId("open-interventions").click();
  await expect(page.getByTestId("interventions")).toBeVisible();
  await shot(page, project, "07-interventions");
  await page.getByTestId("intervene-blight").click();
  await expect(page.getByTestId("forked-badge")).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("forked");

  // ── let both timelines run, then compare them
  await page.getByTestId("speed-5").click();
  await page.getByTestId("play-toggle").click();
  await expect.poll(() => tick(page), { timeout: 120_000 }).toBeGreaterThan(paused + 300);
  await page.getByTestId("play-toggle").click();
  await page.getByTestId("open-compare").click();
  await expect(page.getByTestId("compare")).toBeVisible();
  await expect(page.getByTestId("compare-lede")).toContainText("blight");
  await expect(page.getByTestId("compare-table")).toContainText("Alive now");
  await page.getByTestId("toggle-series-table").click();
  await expect(page.getByTestId("series-table")).toBeVisible();
  await shot(page, project, "08-compare");
  await page.getByTestId("compare-close").click();

  // ── save, reload the page, continue exactly where we were
  const savedTick = await tick(page);
  await page.getByTestId("open-menu").click();
  await page.getByTestId("save-game").click();
  await expect(page.getByTestId("toast")).toContainText("Saved");
  await expect(page.getByTestId("save-list")).toBeVisible();
  await shot(page, project, "09-menu-saved");
  await page.reload();
  await expect(page.getByTestId("title")).toBeVisible();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 7", { timeout: 60_000 });
  await expect.poll(() => tick(page)).toBe(savedTick);
  await expect(page.getByTestId("forked-badge")).toBeVisible(); // the fork and its control twin were saved too
  await page.getByTestId("open-compare").click();
  await expect(page.getByTestId("compare-table")).toContainText("Alive now");
  await page.getByTestId("compare-close").click();
  await page.waitForTimeout(1000);
  await shot(page, project, "10-resumed");

  expect(errors, "console errors").toEqual([]);
  expect(failed, "failed requests (missing assets)").toEqual([]);
  expect(external, "requests to other origins").toEqual([]);
});

test("the keyboard alone can drive the game", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard path is a desktop concern");
  await page.goto("/?q=low&pr=0.6");
  await page.getByTestId("begin").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("setup")).toBeVisible();
  await page.getByTestId("create-world").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("world-label")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("coach-skip").click();
  await page.getByTestId("world-canvas").focus();
  await page.keyboard.press(".");
  await expect.poll(() => tick(page)).toBe(1);
  await page.keyboard.press("5");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "true");
  await expect.poll(() => tick(page), { timeout: 60_000 }).toBeGreaterThan(20);
  await page.keyboard.press(" ");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
  await page.keyboard.press("c");
  await expect(page.getByTestId("chronicle")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chronicle")).toHaveCount(0);
  await page.keyboard.press("i");
  await expect(page.getByTestId("interventions")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("interventions")).toHaveCount(0);
});
