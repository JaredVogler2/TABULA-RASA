import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capture } from "./capture";

/**
 * Phase 14: the laboratory page shows a study bundle as it was run — what kind of seeds it
 * used, every contrast with its interval, the rule's reading, the sizing table — and lets a
 * reader re-run a cell in their own browser and compare the final state's hash with the
 * published one. The statistics themselves are asserted in unit tests; this proves the page
 * says what the bundle says and that the in-browser check really runs the engine.
 */

// the laboratory is a long page: it is captured whole, at a quality that keeps a phone-density capture small
const shot = (page: Page, project: string, name: string, fullPage = true): Promise<void> => capture(page, project, name, { fullPage, quality: fullPage ? 62 : 84 });

interface PublishedCell {
  study: string;
  condition: string;
  seed: number;
  sha256: string;
  digest: string;
}

interface PublishedManifest {
  engine: string;
  runs: number;
  expectedRuns: number;
  seedClass: string;
  hashes: PublishedCell[];
}
interface PublishedReport {
  reports: { study: string; contrasts: { id: string; verdict: string; interval: { estimate: number } }[] }[];
}
const published = <T,>(bundle: string, file: string): T => JSON.parse(readFileSync(join(process.cwd(), "public/studies", bundle, file), "utf8")) as T;
const manifest = published<PublishedManifest>("pilot", "manifest.json");
const report = published<PublishedReport>("pilot", "report.json");
const confirmed = published<PublishedManifest>("confirmatory", "manifest.json");
const confirmedReport = published<PublishedReport>("confirmatory", "report.json");

test("laboratory: a published bundle, read as what it is, and a run reproduced in this browser", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  // ── reached from the title screen, like everything else
  await page.goto("/?q=low&pr=0.6");
  await page.getByTestId("title-lab").click();
  await expect(page).toHaveURL(/\/lab$/);
  await expect(page.getByRole("heading", { level: 1, name: "Laboratory" })).toBeVisible();

  // ── the page opens on the confirmatory batch, named for what it is, with every verdict as the registered rule gave it
  const summary = page.getByTestId("bundle-summary");
  await expect(summary).toContainText("Confirmatory: holdout seeds, used once, at a seed count fixed beforehand");
  await expect(summary).toContainText(`Engine ${confirmed.engine}`);
  await expect(summary).toContainText(`${confirmed.runs} of ${confirmed.expectedRuns} runs`);
  await expect(summary).toContainText("no model consulted");
  await expect(summary).toContainText("cost $0");
  expect(confirmed.seedClass).toBe("confirmatory");
  expect(confirmed.runs).toBe(confirmed.expectedRuns);
  for (const r of confirmedReport.reports) {
    const section = page.getByTestId(`study-${r.study}`);
    await expect(section).toBeVisible();
    await expect(section).toContainText("Confirmatory · holdout seeds");
    for (const c of r.contrasts) {
      const row = page.getByTestId(`contrast-${c.id}`);
      await expect(row).toBeVisible();
      await expect(row.locator("span").last()).toHaveText(c.verdict);
    }
  }
  // the positive control failed on the holdout seeds, and the page says so in the place a success would have been
  const failed = confirmedReport.reports.find((r) => r.study === "h6-institutions")?.contrasts.find((c) => c.id === "h6a");
  expect(failed?.verdict).toBe("falsified");
  await expect(page.getByTestId("contrast-h6a")).toContainText((failed as { interval: { estimate: number } }).interval.estimate.toFixed(3));
  await expect(page.getByTestId("contrast-h6a").locator("span").last()).toHaveAttribute("data-tone", "bad");
  await shot(page, project, "49-laboratory-confirmatory");

  // ── the pilot that sized it is one choice away, and is never dressed as a test
  await page.getByTestId("bundle-select").selectOption("pilot");
  await expect(summary).toContainText("Pilot: development seeds");
  await expect(summary).toContainText("they test nothing");
  await expect(summary).toContainText(`Engine ${manifest.engine}`);
  await expect(summary).toContainText(`${manifest.runs} of ${manifest.expectedRuns} runs`);
  await expect(summary).toContainText("no model consulted");
  await expect(summary).toContainText("cost $0");
  expect(manifest.seedClass).toBe("pilot");

  // ── every registered study and every contrast in the bundle is on the page, with the rule's reading marked as hypothetical
  for (const r of report.reports) {
    const section = page.getByTestId(`study-${r.study}`);
    await expect(section).toBeVisible();
    await expect(section).toContainText("Pilot · development seeds");
    for (const c of r.contrasts) {
      const row = page.getByTestId(`contrast-${c.id}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(`pilot: the rule would read “${c.verdict}”`);
    }
  }
  // the positive control is shown as it came out, not as it was hoped
  const h6a = report.reports.find((r) => r.study === "h6-institutions")?.contrasts.find((c) => c.id === "h6a");
  expect(h6a).toBeDefined();
  await expect(page.getByTestId("contrast-h6a")).toContainText((h6a as { interval: { estimate: number } }).interval.estimate.toFixed(3));
  await expect(page.getByTestId("plan")).toContainText("Sizing the confirmatory batch");
  await shot(page, project, "50-laboratory");

  // ── a published cell, re-run here: the same engine, the same seed, the same final state
  const cell = manifest.hashes.find((h) => h.study === "h2-mobility" && h.condition === "m20" && h.seed === 3) as PublishedCell;
  expect(cell).toBeDefined();
  const index = manifest.hashes.indexOf(cell);
  await page.getByTestId("verify-cell").selectOption(String(index));
  await expect(page.getByTestId("verify")).toContainText(`published ${cell.sha256}`);
  await page.getByTestId("verify-run").click();
  const result = page.getByTestId("verify-result");
  // The published bundles were made by engine 0.7.0. This engine keeps that one's rules for worlds
  // without crafts or newcomers, so the check is on the digest of the state; the file hash also
  // covers the version stamp and is shown, not compared.
  await expect(page.getByTestId("verify-by-digest")).toContainText(`made by engine ${manifest.engine}`);
  await expect(page.getByTestId("verify")).toContainText(`state digest ${cell.digest}`);
  await expect(result).toContainText("Reproduced: the same final state, digest for digest", { timeout: 240_000 });
  await expect(result).toContainText(cell.digest);
  await expect(result).toHaveAttribute("data-tone", "good");
  await page.getByTestId("verify").scrollIntoViewIfNeeded();
  await shot(page, project, "51-run-reproduced");

  // ── the raw tables are one click away
  for (const name of ["report.md", "runs.csv", "manifest.json", "report.json"]) {
    const response = await page.request.get(`/studies/pilot/${name}`);
    expect(response.ok(), name).toBe(true);
  }
  const csv = await (await page.request.get("/studies/pilot/runs.csv")).text();
  expect(csv.trim().split("\n").length).toBe(manifest.runs + 1);

  // ── what a live version would cost at most: ceilings from the price list, and the plain statement that nothing is authorized
  const cost = page.getByTestId("live-cost");
  await expect(cost).toContainText("No spend is authorized");
  await expect(cost).toContainText("no call has ever been made");
  await expect(cost.locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("live-cost-envelope")).toContainText("it is not an authorization");

  // ── nothing on the page is wider than the screen
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow of the page").toBeLessThanOrEqual(0);

  // ── the same cell, opened as a world: the numbers are numbers of something that can be watched
  await page.getByTestId("verify-open").click();
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 3", { timeout: 60_000 });
  await expect(page.getByTestId("toast")).toContainText("the world the laboratory ran");
  await expect(page.getByTestId("tick")).toHaveText("tick 0");
  await page.getByTestId("step-tick").click();
  await expect(page.getByTestId("tick")).toHaveText("tick 1");
  await shot(page, project, "52-cell-as-a-world", false);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
