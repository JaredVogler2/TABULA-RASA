import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { capture } from "./capture";

/**
 * The goal (D-056): the default world is The Long Road, and what gives the one who watches
 * something to steer by is on screen from the first morning — the age, what the next one asks
 * for, the legacy, and a hand that can be used once a season. Everything asserted here is read
 * off the running product: the worker's own reading of the world, shown by the page.
 *
 * What this does not show: that a person finds it a goal worth having; that the closing page
 * opens (it takes years of island time, and is checked by hand: docs/EVIDENCE.md); anything
 * on a physical device.
 */

async function tick(page: Page): Promise<number> {
  const text = (await page.getByTestId("tick").textContent()) ?? "";
  return Number(text.replace(/\D+/g, ""));
}

/** Serious or critical findings of axe-core (WCAG 2.0/2.1 A and AA) on the screen as it stands. */
async function blocking(page: Page, screen: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `[${screen}] ${v.id} (${v.impact}): ${v.help} — ${(v.nodes[0]?.html ?? "").slice(0, 140)}`);
}

/** The box of something a finger presses, as laid out. */
async function boxOf(page: Page, id: string): Promise<{ width: number; height: number }> {
  const box = await page.getByTestId(id).boundingBox();
  return { width: box?.width ?? 0, height: box?.height ?? 0 };
}

test("the goal: an age, a legacy and one change a season, from the first morning; the ladder in the Atlas", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const project = testInfo.project.name;
  const phone = project === "mobile";
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const findings: string[] = [];

  // ── setup: The Long Road is offered first and is chosen; its aim is the aim
  await page.goto("/?q=low&pr=0.6");
  await page.getByTestId("begin").click();
  await expect(page.getByTestId("setup")).toBeVisible();
  const card = page.getByTestId("scenario-long_road");
  await expect(card).toHaveAttribute("aria-checked", "true");
  await expect(card).toContainText("The aim: Bring four in five of the first fifty to the Age of Letters by the end of the fifth year.");
  await expect(page.getByTestId("scenario-first_light")).toContainText("Optional aim: See four in five through the first winter.");
  // crafts and newcomers are part of this scenario: the switch shows it and cannot be turned
  await expect(page.getByTestId("progress-select")).toBeDisabled();
  await expect(page.getByTestId("progress-select")).toHaveValue("on");
  // any other scenario is made as first built unless the switch is turned
  await page.getByTestId("scenario-first_light").click();
  await expect(page.getByTestId("progress-select")).toBeEnabled();
  await expect(page.getByTestId("progress-select")).toHaveValue("off");
  await page.getByTestId("scenario-long_road").click();
  await expect(page.getByTestId("setup")).toContainText("The crafts and what each opens are supplied by the designers");
  await page.getByTestId("seed-input").fill("7");
  await capture(page, project, "60-setup-the-long-road");
  await page.getByTestId("create-world").click();
  await expect(page.getByTestId("world-label")).toHaveText("The Long Road · seed 7", { timeout: 60_000 });
  await page.getByTestId("coach-skip").click();

  // ── the first morning: fifty foragers, nothing built, a whole hand
  const goal = page.getByTestId("goal-bar");
  await expect(goal).toBeVisible();
  await expect(goal).toHaveAttribute("data-age", "0");
  await expect(page.getByTestId("goal-age")).toHaveText("Age of Foraging");
  await expect(page.getByTestId("goal-legacy")).toHaveText("Legacy 500"); // fifty people, ten points each, and nothing else yet
  await expect(page.getByTestId("goal-hand")).toHaveText("1 change this season");
  await expect(page.getByTestId("goal-hand")).toHaveAttribute("data-left", "1");
  // what the next age asks for is spelled out where there is room; on a phone the Atlas has it
  if (phone) await expect(page.getByTestId("goal-next")).toBeHidden();
  else await expect(page.getByTestId("goal-next")).toHaveText("next, hearths: 0 of 5 fires · 0 of 8 dwellings · 0 of 2 stores");
  // the aim on the card, counted down where it is always in sight: how many of the first fifty, and which year of five
  await expect(page.getByTestId("goal-aim")).toHaveText("50 of 50 · year 1 of 5");
  await expect(page.getByTestId("goal-aim")).toHaveAttribute("data-state", "open");
  // Its name to a listener is what it shows, with the two things a listener needs said as well (what the
  // count is a count of, and what pressing it does). A name that differed from the visible words was this
  // test's first finding: axe-core calls it serious, and it is.
  await expect(goal).toHaveAccessibleName(/^Age of Foraging.*Legacy 500.*The aim: 50 of 50 · year 1 of 5.*1 change this season.*Open the Atlas\.$/);
  await expect(goal).not.toHaveAttribute("aria-label");
  if (phone) {
    // a finger can press it, and it does not push the page sideways
    const box = await boxOf(page, "goal-bar");
    expect(box.height, "the goal bar is tall enough for a finger").toBeGreaterThanOrEqual(43.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nothing reaches past the screen").toBe(true);
  }
  findings.push(...(await blocking(page, "the first morning of The Long Road")));
  await capture(page, project, "61-the-goal-first-morning");

  // ── time passes: fires, shelters and stores go up, and the island is in the Age of Hearths
  // (On this island the age comes about the eleventh day. A world at the fastest speed lives more than a day
  // a second, and a page on a software renderer can take seconds to act on a click, so where it stops is not
  // known to the day: nothing below depends on it. What the Chronicle says of an age is held by a unit test.)
  // Sixteen times, not sixty-four: half a minute to the eleventh day, and a slow click then costs three days
  // of island time, not thirteen — the next age is forty days further on.
  await page.getByTestId("speed-4").click();
  await page.getByTestId("play-toggle").click();
  await expect(goal).not.toHaveAttribute("data-age", "0", { timeout: 420_000 });
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
  expect(await tick(page)).toBeGreaterThan(96);
  await expect(page.getByTestId("goal-age")).toHaveText("Age of Hearths");
  if (!phone) await expect(page.getByTestId("goal-next")).toContainText("next, fields:");
  // an age counts for 150 by itself, on top of fifty people who may by now be fewer or more
  const legacy = Number(((await page.getByTestId("goal-legacy").textContent()) ?? "").replace(/\D+/g, ""));
  expect(legacy).toBeGreaterThanOrEqual(150);
  // the aim's count has moved with the calendar and with who is alive
  await expect(page.getByTestId("goal-aim")).toHaveText(/^\d+ of 50 · year 1 of 5$/);
  await capture(page, project, "62-the-age-of-hearths");

  // ── the hand: a note says how often, a stranger with a craft is on offer, and one change spends the season's
  await page.getByTestId("open-interventions").click();
  await expect(page.getByTestId("interventions")).toBeVisible();
  await expect(page.getByTestId("hand-note")).toContainText("This island lets you change it once a season. 1 change this season.");
  // which craft the stranger knows is the observer's to choose, and the panel says who here knows each
  await expect(page.getByTestId("stranger-pick")).toContainText("A stranger with a craft");
  for (const craft of ["tillage", "storekeeping", "masonry", "herb_lore", "millwrighting", "record_keeping"]) await expect(page.getByTestId(`intervene-stranger-${craft}`)).toBeEnabled();
  await expect(page.getByTestId("intervene-stranger-millwrighting")).toContainText("brings tillage and masonry too");
  await expect(page.getByTestId("intervene-stranger-record_keeping")).toContainText(/nobody here knows it · brings storekeeping and masonry too/);
  if (phone) expect((await boxOf(page, "intervene-stranger-tillage")).height, "a craft can be chosen with a finger").toBeGreaterThanOrEqual(43.5);
  findings.push(...(await blocking(page, "interventions with a hand")));
  await capture(page, project, "63-one-change-a-season");
  await page.getByTestId("intervene-bounty").click();
  await expect(page.getByTestId("forked-badge")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("interventions")).toHaveCount(0);
  await expect(page.getByTestId("goal-hand")).toHaveAttribute("data-left", "0");
  await expect(page.getByTestId("goal-hand")).toContainText("Used this season · yours again in");
  // now there is a twin, and its legacy stands beside this world's
  await expect(page.getByTestId("goal-legacy")).toContainText("twin");
  // the same panel again: the note says it is spent and every change waits for the season to turn
  await page.getByTestId("open-interventions").click();
  await expect(page.getByTestId("hand-note")).toContainText("You have used this season's: it is yours again in");
  for (const kind of ["cold_snap", "drought", "blight", "rain", "bounty", "windfall", "newcomers", "hush", "stranger-tillage", "stranger-record_keeping"]) {
    await expect(page.getByTestId(`intervene-${kind}`), `${kind} waits for the season to turn`).toBeDisabled();
  }
  await capture(page, project, "64-the-hand-is-spent");
  await page.getByTestId("interventions-close").click();
  await expect(page.getByTestId("interventions")).toHaveCount(0);

  // ── the Atlas, opened from the goal itself: the ladder, the legacy part by part, the crafts, who drew it
  await goal.click();
  await expect(page.getByTestId("atlas")).toBeVisible();
  const ages = page.getByTestId("ages");
  await expect(ages).toBeVisible();
  await expect(page.getByTestId("age-foraging")).toHaveAttribute("data-state", "reached");
  await expect(page.getByTestId("age-hearths")).toHaveAttribute("data-state", "reached");
  await expect(page.getByTestId("age-hearths")).toContainText(/reached on day \d+/);
  await expect(page.getByTestId("age-fields")).toHaveAttribute("data-state", "next");
  await expect(page.getByTestId("age-fields")).toContainText(/\d of 3 harvests from fields · \d of 3 fields/);
  for (const later of ["stone", "mills", "letters"]) await expect(page.getByTestId(`age-${later}`)).toHaveAttribute("data-state", "ahead");
  // the aim, counted: the card's sentence and how it stands
  await expect(page.getByTestId("aim")).toContainText("Bring four in five of the first fifty to the Age of Letters by the end of the fifth year.");
  await expect(page.getByTestId("aim-yours")).toContainText(/\d+ of the 50 who began are alive\. Four in five is 40/);
  await expect(page.getByTestId("aim-yours")).toContainText("the fifth year ends with day 200");
  await expect(page.getByTestId("ages-hand")).toContainText("Your hand: this island lets you change it once a season. You have used it");
  // the legacy adds up, and the twin's is named beside it
  const table = page.getByTestId("legacy-table");
  await expect(table).toContainText("the untouched twin's is");
  const parts = await table.locator("tbody tr td.tnum").allTextContents();
  const numbers = parts.map((t) => Number(t.replace(/\D+/g, "")));
  expect(numbers.length).toBe(5);
  expect(numbers.slice(0, 4).reduce((a, b) => a + b, 0), "people + crafts + works + ages = legacy").toBe(numbers[4]);
  expect(numbers[3], "one age reached counts 150").toBe(150);
  // six crafts, none known on a day this early in most worlds — the table says what each opens either way
  const crafts = page.getByTestId("crafts-table");
  await expect(crafts.locator("tbody tr")).toHaveCount(6);
  await expect(crafts).toContainText("millwrighting · rests on tillage and masonry");
  await expect(crafts).toContainText("record keeping · rests on storekeeping and masonry");
  // who drew the ladder is said, and the registry is one press away
  await expect(page.getByTestId("ages-designed")).toContainText("were drawn by the designers");
  if (phone) {
    const box = await boxOf(page, "ages-open-designed");
    expect(box.height, "the way to the registry is tall enough for a finger").toBeGreaterThanOrEqual(43.5);
  }
  // the map's key names the works of a world with crafts
  await expect(page.getByTestId("atlas")).toContainText("field (gold when ripe)");
  await expect(page.getByTestId("atlas")).toContainText("record house");
  await ages.scrollIntoViewIfNeeded();
  findings.push(...(await blocking(page, "the Atlas with ages, legacy and crafts")));
  await capture(page, project, "65-ages-legacy-crafts");
  await page.getByTestId("ages-open-designed").scrollIntoViewIfNeeded();
  await page.getByTestId("ages-open-designed").click();
  await expect(page.getByTestId("affordances")).toBeVisible();
  await expect(page.getByTestId("affordances")).toContainText("tech tree");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("affordances")).toHaveCount(0);

  // ── the field journal has the nine pages a world with crafts can fill
  await page.getByTestId("open-menu").click();
  await page.getByTestId("menu-journal").click();
  await expect(page.getByTestId("journal")).toBeVisible();
  await expect(page.getByTestId("journal")).toContainText("of 30");
  await page.getByTestId("journal-close").click();

  expect(findings, `accessibility violations:\n${findings.join("\n")}`).toEqual([]);
  expect(errors, "console and page errors").toEqual([]);
});
