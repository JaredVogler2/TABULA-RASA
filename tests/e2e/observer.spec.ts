import { expect, test, type Page } from "@playwright/test";
import { capture } from "./capture";

/**
 * Phase 12: the observer's instruments, driven with real clicks and taps against the
 * production build — sound that is silent until asked for and then really produces signal,
 * the two views of what a citizen knows, the record of what came of their intentions, the
 * atlas with its almanac, and the field journal that fills in from logged events.
 */

const shot = (page: Page, project: string, name: string): Promise<void> => capture(page, project, name);

async function tick(page: Page): Promise<number> {
  const text = (await page.getByTestId("tick").textContent()) ?? "";
  return Number(text.replace(/\D+/g, ""));
}

async function clickCitizen(page: Page, touch: boolean): Promise<void> {
  for (let attempt = 0; attempt < 14; attempt++) {
    const target = await page.evaluate(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let id = 0; id < 50; id++) {
        const p = window.__tr?.screenOf(id);
        if (p && p.x > w * 0.12 && p.x < w * 0.88 && p.y > h * 0.3 && p.y < h * 0.7) return p;
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

test("the observer's instruments work: sound, what a citizen knows, atlas, almanac and field journal", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  const project = testInfo.project.name;
  const phone = project === "mobile";
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  const external: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.protocol !== "data:" && url.protocol !== "blob:") external.push(req.url());
  });

  await page.goto("/?q=low&pr=0.6");
  await page.getByTestId("begin").click();
  await page.getByTestId("scenario-first_light").click();
  await page.getByTestId("seed-input").fill("7");
  await page.getByTestId("create-world").click();
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 7", { timeout: 60_000 });
  await page.getByTestId("coach-skip").click();

  // ── sound: nothing before it is asked for; real signal after; silence again at zero
  expect(await page.evaluate(() => window.__tr?.soundLevel() ?? -1)).toBe(0);
  if (phone) {
    await page.getByTestId("open-menu").click();
    await page.getByTestId("setting-sound").click();
    await expect(page.getByTestId("setting-sound")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("menu-close").click();
  } else {
    await page.getByTestId("toggle-sound").click();
    await expect(page.getByTestId("toggle-sound")).toHaveAttribute("aria-pressed", "true");
  }
  // The sound is tried with the world going at its slowest. It used to be tried at the fastest, where a world
  // lives a day in under a second: on a software renderer each of the seven clicks below takes seconds, so
  // by the time the world was paused it had lived anything from thirty-four days to fifty (measured, three
  // runs each on three builds) — and the aim read further down is decided on the forty-first morning. The
  // test passed when the clicks happened to be quick, on `main` as much as anywhere.
  await page.getByTestId("speed-0").click();
  await page.getByTestId("play-toggle").click();
  // wind and surf are continuous: what reaches the speakers is not silence
  await expect.poll(() => page.evaluate(() => window.__tr?.soundLevel() ?? 0), { timeout: 30_000 }).toBeGreaterThan(0.0005);
  await page.getByTestId("open-menu").click();
  await page.getByTestId("level-master").fill("0");
  await expect.poll(() => page.evaluate(() => window.__tr?.soundLevel() ?? 1), { timeout: 15_000 }).toBeLessThan(0.0002);
  await page.getByTestId("level-master").fill("70");
  await page.getByTestId("setting-sound").click();
  await expect(page.getByTestId("setting-sound")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("menu-close").click();

  // ── a few days of an island of planners, at sixteen times: a slow click then costs days, not weeks
  await page.getByTestId("speed-4").click();
  await expect.poll(() => tick(page), { timeout: 300_000 }).toBeGreaterThan(300);
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
  // wherever it stopped, the first winter is not over: what is read of the aim below depends on that
  expect(await tick(page), "the world was paused before the thirtieth day").toBeLessThan(30 * 96);

  // ── the field journal has pages for what was logged, and questions for what was not
  if (phone) {
    await page.getByTestId("open-menu").click();
    await page.getByTestId("menu-journal").click();
  } else {
    await page.getByTestId("open-journal").click();
  }
  await expect(page.getByTestId("journal")).toBeVisible();
  const pages = page.getByTestId("journal-entries").locator("li");
  await expect(pages.first()).toBeVisible();
  const seen = await pages.count();
  const open = await page.getByTestId("journal-open").locator("li").count();
  expect(seen).toBeGreaterThan(0);
  expect(seen + open).toBe(21);
  await shot(page, project, "30-journal");
  await page.getByTestId("journal-close").click();

  // ── a citizen: what they set out to do and what came of it; what they know; whom they know
  await clickCitizen(page, phone);
  await expect(page.getByTestId("outcomes").locator("li").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("overlay-knowledge").click();
  await expect(page.getByTestId("overlay-knowledge")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("overlay-legend")).toContainText("has never seen");
  await expect(page.getByTestId("overlay-legend")).toContainText(/of 4,096 tiles are known to them/);
  await page.getByTestId("overlay-ties").click();
  await expect(page.getByTestId("overlay-legend")).toContainText(/Arcs lead to|has dealt with nobody yet/);
  await page.waitForTimeout(1500);
  await shot(page, project, "31-what-they-know");

  // ── the atlas: the map says what it shows, the almanac has its seven measures and their numbers
  await page.getByTestId("open-atlas").click();
  await expect(page.getByTestId("atlas-map")).toBeVisible();
  await expect(page.getByTestId("atlas-summary")).toContainText(/\d+ living people; \d+ hearths/);
  for (const id of ["alive", "welfare", "food", "wild", "commons", "gini", "structures"]) await expect(page.getByTestId(`trend-${id}`)).toBeVisible();
  // nothing in the atlas is laid out beyond the edge of the screen: on a phone the map and the almanac are one column
  const viewport = page.viewportSize()!;
  for (const id of ["atlas-map", "trend-alive", "trend-welfare", "trend-food", "trend-wild", "trend-commons", "trend-gini", "trend-structures"]) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.x, `${id}: left edge`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${id}: right edge`).toBeLessThanOrEqual(viewport.width + 0.5);
  }
  // ── the aim on this world's card, counted: in the card's own words, where it stands, and that nobody has touched this world
  await expect(page.getByTestId("aim-text")).toHaveText("See four in five through the first winter.");
  await expect(page.getByTestId("aim-yours")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("aim-yours-state")).toHaveText("Open");
  await expect(page.getByTestId("aim-yours")).toContainText(/\d+ of the 50 who began are alive\. Four in five is 40\./);
  await expect(page.getByTestId("aim-yours")).toContainText("The first winter ends on the morning of day 41.");
  await expect(page.getByTestId("aim-no-twin")).toBeVisible();
  await expect(page.getByTestId("aim-twin")).toHaveCount(0);
  {
    const b = (await page.getByTestId("aim").boundingBox())!;
    expect(b.x, "aim: left edge").toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, "aim: right edge").toBeLessThanOrEqual(viewport.width + 0.5);
  }
  await page.getByTestId("aim").scrollIntoViewIfNeeded();
  await shot(page, project, "32a-the-aim");
  await page.getByTestId("almanac-table-toggle").click();
  await expect(page.getByTestId("almanac-table").locator("tbody tr").first()).toBeVisible();
  await shot(page, project, "32-atlas");
  // clicking the map looks there and puts the map away
  const box = (await page.getByTestId("atlas-map").boundingBox())!;
  await page.getByTestId("atlas-map").click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(page.getByTestId("atlas")).toHaveCount(0);

  // turning the views off again leaves no legend behind
  await page.getByTestId("overlay-knowledge").click();
  await page.getByTestId("overlay-ties").click();
  await expect(page.getByTestId("overlay-legend")).toHaveCount(0);

  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  expect(external, `requests left the device: ${external.join(" | ")}`).toEqual([]);
});
