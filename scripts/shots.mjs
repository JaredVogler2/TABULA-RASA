/**
 * Capture screenshots of the live product through the /studio view.
 *
 *   node scripts/shots.mjs <outDir> [shotName ...]
 *
 * Requires a running server (default http://127.0.0.1:3210, override with SHOTS_URL).
 * Headless Chromium renders through SwiftShader here, so these images show what the
 * product draws, not how fast a real device draws it.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const BASE = process.env.SHOTS_URL ?? "http://127.0.0.1:3210";
const out = process.argv[2] ?? "evidence/shots";
const only = process.argv.slice(3);

const SHOTS = {
  vista: { w: 1920, h: 1080, q: "?scenario=first_light&seed=1&days=2&ticks=22&q=high&az=0.62&polar=0.88" },
  vista_laptop: { w: 1366, h: 768, q: "?scenario=first_light&seed=1&days=2&ticks=22&q=high&az=0.62&polar=0.88" },
  closeup: { w: 1920, h: 1080, q: "?scenario=first_light&seed=1&days=2&ticks=30&q=high&agent=7&az=0.9&polar=1.08&dist=13" },
  // people at work, close enough to read a pose, a tool and a load
  woodcutter: { w: 1366, h: 768, q: "?scenario=first_light&seed=1&days=4&ticks=30&q=high&doing=gather_wood&az=0.7&polar=0.9&dist=8" },
  forager: { w: 1366, h: 768, q: "?scenario=first_light&seed=1&days=4&ticks=30&q=high&doing=gather_forage&az=2.2&polar=1.1&dist=7" },
  fisher: { w: 1366, h: 768, q: "?scenario=first_light&seed=1&days=2&ticks=25&q=high&doing=gather_fish&az=-0.6&polar=1.0&dist=8" },
  builder: { w: 1366, h: 768, q: "?scenario=first_light&seed=1&days=4&ticks=30&q=high&doing=build&az=2.6&polar=0.85&dist=9" },
  // a ratified agreement and the stores it governs (scripted control: labelled as such in the product)
  charter: { w: 1366, h: 768, q: "?scenario=long_winter&seed=1&days=14&ticks=30&q=high&inst=scripted_control&charter=1&az=0.5&polar=0.95&dist=11" },
  // three weeks in: where people have really walked, the ground and the grass show it
  paths: { w: 1366, h: 768, q: "?scenario=first_light&seed=1&days=22&ticks=30&q=high&az=0.3&polar=0.62&dist=38" },
  // what one citizen knows, against what the observer sees
  knowledge: { w: 1366, h: 768, q: "?scenario=first_light&seed=1&days=6&ticks=30&q=high&agent=7&know=1&ties=1&az=0.62&polar=0.8&dist=70&settle=1800" },
  midday: { w: 1920, h: 1080, q: "?scenario=first_light&seed=1&days=3&ticks=26&q=high&az=-0.5&polar=0.98&dist=46&tx=30&ty=30" },
  dusk: { w: 1920, h: 1080, q: "?scenario=first_light&seed=1&days=3&ticks=47&q=high&az=1.9&polar=1.02&dist=58" },
  night: { w: 1920, h: 1080, q: "?scenario=first_light&seed=1&days=3&ticks=76&q=high&az=0.4&polar=0.95&dist=70" },
  winter: { w: 1920, h: 1080, q: "?scenario=first_light&seed=1&days=33&ticks=28&q=high&az=0.62&polar=0.9" },
  phone: { w: 390, h: 844, dpr: 3, q: "?scenario=first_light&seed=1&days=2&ticks=22&q=medium&az=0.62&polar=0.86" },
  phone_landscape: { w: 844, h: 390, dpr: 3, q: "?scenario=first_light&seed=1&days=2&ticks=22&q=medium&az=0.62&polar=0.92" },
  low: { w: 1366, h: 768, q: "?scenario=first_light&seed=1&days=2&ticks=22&q=low&az=0.62&polar=0.88" },
};

const names = only.length ? only : Object.keys(SHOTS);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
let failed = false;
for (const name of names) {
  const shot = SHOTS[name];
  if (!shot) {
    console.error(`unknown shot ${name}`);
    failed = true;
    continue;
  }
  const context = await browser.newContext({ viewport: { width: shot.w, height: shot.h }, deviceScaleFactor: shot.dpr ?? 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const started = Date.now();
  await page.goto(`${BASE}/studio${shot.q}${process.env.SHOTS_EXTRA ?? ""}`);
  try {
    await page.waitForFunction(() => window.__studio?.ready === true, null, { timeout: 240_000 });
  } catch {
    console.error(`${name}: studio did not become ready: ${await page.getByTestId("studio-status").textContent()}`);
    failed = true;
  }
  const stats = await page.evaluate(() => window.__studio?.stats());
  // SHOTS_FORMAT=jpeg keeps committed evidence small; PNG is the default for close inspection
  const jpeg = process.env.SHOTS_FORMAT === "jpeg";
  const file = join(out, `${name}.${jpeg ? "jpg" : "png"}`);
  try {
    // a software renderer under load can take most of a minute to hand over one frame
    await page.screenshot(jpeg ? { path: file, type: "jpeg", quality: 88, timeout: 180_000 } : { path: file, timeout: 180_000 });
  } catch (err) {
    console.error(`${name}: the screenshot could not be taken: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    failed = true;
    await context.close();
    continue;
  }
  console.log(`${name}: ${file} (${Date.now() - started} ms) ${JSON.stringify(stats)}${errors.length ? ` ERRORS ${JSON.stringify(errors.slice(0, 3))}` : ""}`);
  if (errors.length) failed = true;
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
