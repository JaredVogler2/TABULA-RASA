import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Where captures go: `E2E_SHOTS=<dir> pnpm e2e` keeps them; otherwise they land under test-results. */
export const SHOTS = process.env.E2E_SHOTS ?? "test-results/shots";

/**
 * A picture of the running product, kept as evidence for people to look at. The tests assert
 * on the DOM and on measured boxes, never on pixels.
 *
 * Headless Chromium on a software renderer is occasionally unable to produce a frame at the
 * moment it is asked ("Protocol error (Page.captureScreenshot): Unable to capture screenshot").
 * It happened once in CI on a plain sign-in page, in a run whose twin on the same commit
 * passed. That is the browser's state at that instant, not the product's, so the capture is
 * tried again, and a retry is written into the test's annotations so that it is not invisible.
 * If the screen still cannot be captured the test fails: a screen that can never be pictured
 * is something to look into, not something to wave through.
 */
export async function capture(page: Page, project: string, name: string, options: { fullPage?: boolean; quality?: number } = {}): Promise<void> {
  mkdirSync(join(SHOTS, project), { recursive: true });
  const path = join(SHOTS, project, `${name}.jpg`);
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await page.screenshot({ path, type: "jpeg", quality: options.quality ?? 84, fullPage: options.fullPage ?? false });
      if (attempt > 1) {
        test.info().annotations.push({ type: "capture-retried", description: `${project}/${name}: taken on attempt ${attempt} after "${String(last).split("\n")[0]}"` });
        console.warn(`[capture] ${project}/${name}: taken on attempt ${attempt}`);
      }
      return;
    } catch (err) {
      last = err;
      await page.waitForTimeout(500 * attempt);
    }
  }
  throw last;
}
