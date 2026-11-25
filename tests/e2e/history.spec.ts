import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture } from "./capture";

/**
 * Phase 13: going back in a world's own history, world lines, files, and recorded causes —
 * through the real interface. The exactness claims (same state, bit for bit) are asserted by
 * the engine's unit tests; here the product is shown to do the same things end to end and to
 * say truthfully what happened.
 */

const shot = (page: Page, project: string, name: string): Promise<void> => capture(page, project, name);

/** The parts of the top bar must never overlap one another or run off the screen, whatever is in them. */
async function expectTopBarLaidOut(page: Page): Promise<void> {
  const ids = ["brand", "fork-controls", "status-bar", "tools"];
  const view = page.viewportSize()!;
  const boxes = await Promise.all(ids.map(async (id) => ({ id, box: (await page.getByTestId(id).boundingBox())! })));
  for (const { id, box } of boxes) {
    expect(box, `${id} is on screen`).not.toBeNull();
    expect(box.x, `${id}: left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, `${id}: right edge`).toBeLessThanOrEqual(view.width + 0.5);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!.box;
      const b = boxes[j]!.box;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > 0.5 && overlapY > 0.5, `${boxes[i]!.id} overlaps ${boxes[j]!.id}`).toBe(false);
    }
  // nothing inside a bar is wider than the bar
  const spills = await page.evaluate((list) => list.filter((id) => { const el = document.querySelector(`[data-testid="${id}"]`); return el !== null && el.scrollWidth > el.clientWidth + 1; }), ids);
  expect(spills, `content spilling out of ${spills.join(", ")} at ${view.width}px`).toEqual([]);
  // the fork badge is whole: not clipped by the pill that holds it
  const badge = (await page.getByTestId("forked-badge").boundingBox())!;
  const pill = (await page.getByTestId("fork-controls").boundingBox())!;
  expect(badge.x).toBeGreaterThanOrEqual(pill.x - 0.5);
  expect(badge.x + badge.width).toBeLessThanOrEqual(pill.x + pill.width + 0.5);
}

async function tick(page: Page): Promise<number> {
  const text = (await page.getByTestId("tick").textContent()) ?? "";
  return Number(text.replace(/\D+/g, ""));
}

/**
 * Let time run until the world has passed `target`, then stop it. The worker keeps its pace
 * however slowly the page is drawn, so the world overshoots by however long the pause takes to
 * land: nothing below assumes a tick, only an order of events. A moderate speed keeps the
 * overshoot to a day or two.
 */
async function playUntil(page: Page, target: number): Promise<number> {
  await page.getByTestId("speed-4").click();
  if ((await page.getByTestId("play-toggle").getAttribute("data-playing")) !== "true") await page.getByTestId("play-toggle").click();
  await expect.poll(() => tick(page), { timeout: 240_000 }).toBeGreaterThan(target);
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
  return tick(page);
}

test("history: an exact re-run, the twin on screen, a new line, a return, a rebuilt past, an export, a refused import and a recorded cause", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const project = testInfo.project.name;
  // where the minutes go, printed at the end: this is the longest flow in the suite
  const started = Date.now();
  const marks: string[] = [];
  const mark = (label: string): void => {
    marks.push(`${Math.round((Date.now() - started) / 1000)}s ${label}`);
  };
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  // the smallest picture the renderer will draw: this flow is about panels and state, and every frame costs the CPU here
  await page.goto("/?q=low&pr=0.4");
  await page.getByTestId("begin").click();
  await page.getByTestId("scenario-first_light").click();
  await page.getByTestId("seed-input").fill("7");
  await page.getByTestId("create-world").click();
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 7", { timeout: 60_000 });
  await page.getByTestId("coach-skip").click();

  // ── five days; then the observer's hand; then two more
  const forkAt = await playUntil(page, 400);
  const forkDay = Math.floor(forkAt / 96) + 1;
  await page.getByTestId("open-interventions").click();
  await page.getByTestId("intervene-blight").click();
  await expect(page.getByTestId("forked-badge")).toHaveText(`Forked on day ${forkDay}`);
  await expectTopBarLaidOut(page);
  // the same at other window widths: laptops and a wide monitor on the desktop project, small phones on the other
  const home = page.viewportSize()!;
  // (`scripts/topbar.mjs` measures twenty-five widths; these are the ones on either side of each change of layout)
  for (const width of project === "desktop" ? [1920, 1440, 1280, 1024] : [430, 360, 320]) {
    await page.setViewportSize({ width, height: home.height });
    await expect.poll(async () => (await page.getByTestId("tools").boundingBox()) !== null).toBe(true);
    await expectTopBarLaidOut(page);
  }
  await page.setViewportSize(home);
  mark("forked, top bar measured");
  const left = await playUntil(page, forkAt + 150);

  // ── the untouched twin, on screen: same camera, same moment, nothing to be done to it
  await page.getByTestId("view-twin").click();
  await expect(page.getByTestId("twin-badge")).toContainText("The untouched twin");
  await expect(page.getByTestId("twin-badge")).toContainText(`without anything you did since day ${forkDay}`);
  expect(await tick(page)).toBe(left);
  await expect(page.getByTestId("open-interventions")).toBeDisabled();
  await expect(page.getByTestId("forked-badge")).toBeVisible();
  await shot(page, project, "39-the-untouched-twin");
  await page.getByTestId("twin-back").click();
  await expect(page.getByTestId("twin-badge")).toHaveCount(0);
  await expect(page.getByTestId("open-interventions")).toBeEnabled();
  mark("twin seen");

  // ── watch it again: the same days, the same intervention at the same moment, the same world at the end
  await page.getByTestId("open-history").click();
  await expect(page.getByTestId("history")).toBeVisible();
  await expect(page.getByTestId("branches").locator("li")).toHaveCount(1);
  await expect(page.locator('[data-testid^="world-line-"]')).toHaveCount(1);
  await page.getByTestId("moment-192").click();
  await shot(page, project, "40-history");
  await page.getByTestId("rewind-rerun").click();
  await expect(page.getByTestId("rerun-badge")).toBeVisible();
  await expect(page.getByTestId("rerun-badge")).toContainText("1 of your interventions still to come");
  // (that the fork is not on screen until its tick is re-reached is asserted, tick by tick, in the worker's own tests)
  await expect(page.getByTestId("rerun-state")).toHaveText("arrived: the world is exactly the one you left", { timeout: 240_000 });
  expect(await tick(page)).toBe(left);
  await expect(page.getByTestId("forked-badge")).toBeVisible();
  await shot(page, project, "41-rerun-arrived");
  // while it was re-running, the past could not be changed (asserted in the worker's own tests); now time is live again
  await page.getByTestId("step-tick").click();
  await expect.poll(() => tick(page)).toBe(left + 1);
  await expect(page.getByTestId("rerun-badge")).toHaveCount(0);
  mark("watched again");

  // ── leave from before the intervention: a new line with no fork; the old line is set aside
  await page.getByTestId("open-history").click();
  await page.getByTestId("moment-384").click();
  await page.getByTestId("rewind-branch").click();
  await expect(page.getByTestId("history")).toHaveCount(0);
  expect(await tick(page)).toBe(384);
  await expect(page.getByTestId("forked-badge")).toHaveCount(0);
  await page.getByTestId("open-history").click();
  await expect(page.getByTestId("branches").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("branches")).toContainText(`you: blight (day ${forkDay})`);
  await expect(page.getByTestId("branches")).toContainText("untouched");
  await expect(page.locator('[data-testid^="world-line-"]')).toHaveCount(2);
  await expect(page.getByTestId("world-lines")).toHaveAttribute("aria-label", /2 world lines\..*left on day 5/);
  await shot(page, project, "42-world-lines");

  // ── return to the line that was set aside, at the moment it was left
  await page.locator('[data-testid^="return-"]').first().click();
  expect(await tick(page)).toBe(left + 1);
  await expect(page.getByTestId("forked-badge")).toBeVisible();

  // ── the two worlds counted side by side
  await page.getByTestId("open-compare").click();
  await expect(page.getByTestId("state-table")).toContainText("People alive");
  await expect(page.getByTestId("state-table")).toContainText("Resource places stripped bare");
  await expect(page.getByTestId("happened-table")).toContainText("Deaths");
  await expect(page.getByTestId("happened-table")).toContainText("Units gathered from the land");
  await expect(page.getByTestId("delta-charts").locator("svg")).toHaveCount(3);
  await page.getByTestId("delta-charts").scrollIntoViewIfNeeded();
  await shot(page, project, "44-compare-differences");
  await page.getByTestId("compare-close").click();
  mark("new line, return, compare");

  // ── saved, the page reloaded, the world opened again: only the present is in memory, and the past can be lived again from the seed
  await page.getByTestId("open-menu").click();
  await page.getByTestId("save-game").click();
  await expect(page.getByTestId("toast")).toContainText("Saved");
  await expect(page.getByTestId("save-list")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("title")).toBeVisible();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 7", { timeout: 60_000 });
  await expect.poll(() => tick(page)).toBe(left + 1);
  // the fork is the one that was saved, on the day it happened
  await expect(page.getByTestId("forked-badge")).toHaveText(`Forked on day ${forkDay}`);
  await page.getByTestId("open-history").click();
  await expect(page.getByTestId("rebuild-offer")).toBeVisible();
  await expect(page.getByTestId("moment-0")).toHaveCount(0);
  await page.getByTestId("rebuild-past").click();
  await expect(page.getByTestId("toast")).toContainText("arriving at exactly this world", { timeout: 120_000 });
  await expect(page.getByTestId("moment-0")).toBeVisible();
  await expect(page.getByTestId("moment-384")).toBeVisible();
  await expect(page.getByTestId("rebuild-offer")).toHaveCount(0);
  await shot(page, project, "45-past-rebuilt");
  // a rebuilt morning is as good as a remembered one: re-run from it and arrive at the saved world
  await page.getByTestId("moment-384").click();
  await page.getByTestId("rewind-rerun").click();
  await expect(page.getByTestId("rerun-state")).toHaveText("arrived: the world is exactly the one you left", { timeout: 240_000 });
  expect(await tick(page)).toBe(left + 1);
  await page.getByTestId("step-tick").click();
  await expect.poll(() => tick(page)).toBe(left + 2);
  await expect(page.getByTestId("rerun-badge")).toHaveCount(0);
  mark("saved, reloaded, past rebuilt, re-run from it");

  // ── export, then two ways back in: an altered file is refused, the real one is opened
  await page.getByTestId("open-history").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-world").click()]);
  expect(download.suggestedFilename()).toMatch(/^tabula-rasa-first_light-seed7-day\d+\.json$/);
  const dir = testInfo.outputPath("files");
  mkdirSync(dir, { recursive: true });
  const good = join(dir, "world.json");
  await download.saveAs(good);
  const text = readFileSync(good, "utf8");
  const bundle = JSON.parse(text) as { format: string; manifest: { seed: number; tick: number; interventions: { kind: string; origin: string }[]; snapshot: { sha256: string } }; control: unknown };
  expect(bundle.format).toBe("tabula-rasa/bundle");
  expect(bundle.manifest.seed).toBe(7);
  expect(bundle.manifest.tick).toBe(left + 2);
  expect(bundle.manifest.interventions.filter((i) => i.origin === "observer").map((i) => i.kind)).toEqual(["blight"]);
  expect(bundle.manifest.snapshot.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(bundle.control).not.toBeNull();

  // the engine's ledger of what happened, one event a line, each with its recorded causes
  const [ledger] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-ledger").click()]);
  expect(ledger.suggestedFilename()).toMatch(/^tabula-rasa-first_light-seed7-day\d+-ledger\.jsonl$/);
  const ledgerFile = join(dir, "ledger.jsonl");
  await ledger.saveAs(ledgerFile);
  const ledgerLines = readFileSync(ledgerFile, "utf8").trimEnd().split("\n");
  const ledgerHead = JSON.parse(ledgerLines[0] as string) as { format: string; seed: number; events: number; firstId: number; lastId: number; complete: boolean };
  expect(ledgerHead.format).toBe("tabula-rasa/ledger");
  expect(ledgerHead.seed).toBe(7);
  expect(ledgerHead.events).toBe(ledgerLines.length - 1);
  expect(ledgerHead.events).toBeGreaterThan(1000);
  // the past was lived again from the seed a moment ago, so the ledger reaches back to the first event
  expect(ledgerHead.firstId).toBe(0);
  expect(ledgerHead.complete).toBe(true);
  const firstEvent = JSON.parse(ledgerLines[1] as string) as { id: number; t: number; k: string };
  expect(firstEvent.id).toBe(0);

  const at = text.indexOf('\\"hydration\\":');
  expect(at).toBeGreaterThan(0);
  const digit = at + text.slice(at).search(/[0-9]/);
  const bad = join(dir, "altered.json");
  writeFileSync(bad, text.slice(0, digit) + (text[digit] === "5" ? "6" : "5") + text.slice(digit + 1));

  // go somewhere else first, so that a refused import can be seen to change nothing
  await page.getByTestId("history-close").click();
  await page.getByTestId("step-tick").click();
  await expect.poll(() => tick(page)).toBe(left + 3);
  await page.getByTestId("open-history").click();
  await page.getByTestId("import-file").setInputFiles(bad);
  await expect(page.getByTestId("toast")).toContainText("Refused");
  await expect(page.getByTestId("toast")).toContainText(/hash mismatch|not valid|does not describe/);
  expect(await tick(page)).toBe(left + 3);

  await page.getByTestId("import-file").setInputFiles(good);
  await expect(page.getByTestId("toast")).toContainText("Its contents match its manifest");
  expect(await tick(page)).toBe(left + 2);
  await expect(page.getByTestId("forked-badge")).toBeVisible();

  mark("files out and in");

  // ── a recorded cause: what the engine logged as leading to an event
  await playUntil(page, left + 120);
  await page.getByTestId("open-chronicle").click();
  const why = page.locator('[data-testid^="why-"]').first();
  await expect(why).toBeVisible({ timeout: 30_000 });
  await why.click();
  await expect(page.getByTestId("trace")).toContainText("links the engine recorded");
  await shot(page, project, "43-recorded-cause");
  mark("recorded cause");
  console.log(`[history ${project}] ${marks.join(" · ")}`);

  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
