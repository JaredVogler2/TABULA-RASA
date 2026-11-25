import { expect, test, type Cookie, type Page } from "@playwright/test";
import { capture } from "./capture";
import { E2E_PASSPHRASE } from "./constants";

/**
 * Phases 06–08, through the real server: the owner console, a society of mock minds advanced
 * epoch by epoch by HTTP steps, its publication, and its replay — verified against the
 * record — by a visitor with no session. Live mode is off on this server and no provider can
 * be reached; the mock provider is a labelled test double.
 *
 * The console needs the server's ledger database. Without one (TEST_DATABASE_URL unset) those
 * tests are skipped by name; the bundled recording needs nothing and always runs.
 */
const HAS_DB = Boolean(process.env.TEST_DATABASE_URL) || Boolean(process.env.E2E_BASE_URL);

// whole-page captures of a long console are large at a phone's pixel density: a lower quality keeps the evidence small
const shot = (page: Page, project: string, name: string, fullPage = false): Promise<void> => capture(page, project, name, { fullPage, quality: fullPage ? 62 : 84 });

/** Click (or tap) a living citizen in the 3D world at its real on-screen position. */
async function clickCitizen(page: Page, touch: boolean): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const target = await page.evaluate(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let id = 0; id < 50; id++) {
        const p = window.__tr?.screenOf(id);
        if (p && p.x > w * 0.12 && p.x < w * 0.88 && p.y > h * 0.3 && p.y < h * 0.72) return p;
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
        // missed: try again
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error("could not select a citizen by clicking the world");
}

/**
 * Sign-in is throttled to five attempts a quarter of an hour per address — for the tests too.
 * So each project signs in once and later tests carry the same session cookie.
 */
const sessions = new Map<string, Cookie[]>();

async function signIn(page: Page, project: string): Promise<void> {
  const saved = sessions.get(project);
  if (saved) await page.context().addCookies(saved);
  await page.goto("/owner");
  if (!saved) {
    await page.getByTestId("passphrase").fill(E2E_PASSPHRASE);
    await page.getByTestId("signin").click();
  }
  await expect(page.getByTestId("live-panel")).toBeVisible();
  if (!saved) sessions.set(project, await page.context().cookies());
}

test.describe.configure({ mode: "serial" });

test("a visitor without a session learns nothing and can change nothing", async ({ request, baseURL }, testInfo) => {
  const status = await request.get("/api/owner/status");
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({ signedIn: false, signInPossible: true });
  expect(status.headers()["cache-control"]).toBe("no-store");

  const origin = baseURL as string;
  const writes: [string, unknown][] = [
    ["/api/owner/budget", { authorizedUsd: 200, dailyCapUsd: 200, confirm: "I authorize this spending" }],
    ["/api/owner/kill", { on: false }],
    ["/api/owner/reconcile", { id: "x", action: "release" }],
    ["/api/runs", { world: { scenario: "first_light", seed: 1 }, spec: {} }],
    ["/api/runs/preview", { world: { scenario: "first_light", seed: 1 }, spec: {} }],
    ["/api/runs/run_abcdef12/step", {}],
    ["/api/runs/run_abcdef12/control", { action: "publish" }],
  ];
  for (const [path, data] of writes) {
    // as this site's own page would send it, minus the session: not signed in
    const sameSite = await request.post(path, { data, headers: { origin } });
    expect(sameSite.status(), path).toBe(401);
    // as another site would send it: refused before the session is even looked at
    const crossSite = await request.post(path, { data, headers: { origin: "https://evil.example" } });
    expect(crossSite.status(), path).toBe(403);
    // with a forged session cookie
    const forged = await request.post(path, { data, headers: { origin, cookie: "tr_owner=v1.eyJ2IjoxfQ.AAAA", "x-csrf-token": "AAAA" } });
    expect(forged.status(), path).toBe(401);
  }
  // an unpublished or unknown run does not exist for a visitor
  expect((await request.get("/api/runs/run_abcdef12")).status()).toBe(HAS_DB ? 404 : 503);
  if (testInfo.project.name === "desktop") {
    // (once, not per project: sign-in attempts are rationed)
    const wrong = await request.post("/api/owner/login", { data: { passphrase: "not the passphrase" }, headers: { origin } });
    expect(wrong.status()).toBe(HAS_DB ? 401 : 503);
    expect(wrong.headers()["set-cookie"]).toBeUndefined();
  }
});

test("the owner signs in, sees that nothing can be spent, runs a mock society and publishes it", async ({ page }, testInfo) => {
  test.skip(!HAS_DB, "needs TEST_DATABASE_URL: the owner console keeps its ledger in PostgreSQL");
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/owner");
  await expect(page.getByTestId("passphrase")).toBeVisible();
  await shot(page, project, "20-owner-signin");
  if (project === "desktop") {
    // a wrong passphrase is refused in plain words; nothing about the deployment is shown
    await page.getByTestId("passphrase").fill("definitely not it");
    await page.getByTestId("signin").click();
    await expect(page.getByText("That is not the passphrase.")).toBeVisible();
    await expect(page.getByTestId("live-panel")).toHaveCount(0);
  }

  await signIn(page, project);
  // fail-closed defaults, as shipped: no live calls, nothing authorized, the switch on
  await expect(page.getByTestId("live-state")).toContainText("Unavailable");
  await expect(page.getByTestId("live-reasons")).toContainText("LIVE_ENABLED is not set to true");
  await expect(page.getByTestId("authorized")).toHaveText("$0.00");
  await expect(page.getByTestId("kill-state")).toContainText("Kill switch is ON");
  await expect(page.getByTestId("run-provider").locator("option[value=anthropic]")).toHaveAttribute("disabled", "");
  await expect(page.getByTestId("run-provider").locator("option[value=anthropic]")).toHaveText("Live — unavailable on this deployment");
  // the session cookie cannot be read by scripts, and the page holds no credential
  expect(await page.evaluate(() => document.cookie)).toBe("");
  const html = await page.content();
  expect(html).not.toMatch(/sk-ant-|scrypt:|postgres:\/\//);
  await shot(page, project, "21-owner-console", true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // a society of mock minds: preview, create, advance to the end
  await page.getByTestId("run-title").fill(`Mock society (${project})`);
  await page.getByTestId("run-population").fill("12");
  await page.getByTestId("run-epochs").fill("8");
  await page.getByTestId("run-preview").click();
  await expect(page.getByTestId("preview-worst")).toHaveText("$0.00");
  await expect(page.getByTestId("preview")).toContainText("This provider makes no paid calls.");
  await page.getByTestId("run-create").click();
  const run = page.getByTestId("run").first();
  await expect(run.getByTestId("run-status")).toHaveText("active");
  await run.getByTestId("run-advance").click();
  await expect(run.getByTestId("run-status")).toHaveText("done", { timeout: 120_000 });
  await expect(run.getByTestId("run-progress")).toHaveText("Epoch 8 of 8");
  await expect(run).toContainText("MOCK minds");
  await expect(run).toContainText("no cost");
  // nothing was spent, held or authorized by any of it
  await expect(page.getByTestId("authorized")).toHaveText("$0.00");
  await expect(page.getByTestId("budget-panel")).toContainText("Spent $0.00");

  await run.getByTestId("run-publish").click();
  await expect(run.getByTestId("run-status")).toContainText("published");
  await shot(page, project, "22-owner-run-done", true);
  expect(errors).toEqual([]);
});

test("authorizing spend takes the words, and the kill switch works from the console", async ({ page }, testInfo) => {
  test.skip(!HAS_DB, "needs TEST_DATABASE_URL: the owner console keeps its ledger in PostgreSQL");
  test.skip(testInfo.project.name !== "desktop", "one pass is enough: this changes the shared ledger");
  await signIn(page, testInfo.project.name);
  await page.getByText("Change the authorization").click();
  await page.getByTestId("budget-total").fill("2");
  await page.getByTestId("budget-daily").fill("2");
  // without the confirmation phrase the button stays shut
  await expect(page.getByTestId("budget-submit")).toBeDisabled();
  await page.getByTestId("budget-phrase").fill("yes");
  await expect(page.getByTestId("budget-submit")).toBeDisabled();
  await page.getByTestId("budget-phrase").fill("I authorize this spending");
  await page.getByTestId("budget-submit").click();
  await expect(page.getByTestId("authorized")).toHaveText("$2.00");
  // authorizing does not release the switch: that is a second, separate act
  await expect(page.getByTestId("kill-state")).toContainText("Kill switch is ON");
  await page.getByTestId("kill-toggle").click();
  await expect(page.getByTestId("kill-state")).toContainText("Kill switch is off");
  await page.getByTestId("kill-toggle").click();
  await expect(page.getByTestId("kill-state")).toContainText("Kill switch is ON");
  // and with all of that, live calls are still unavailable on this server: no key, no model, no switch
  await expect(page.getByTestId("live-state")).toContainText("Unavailable");
  await shot(page, testInfo.project.name, "23-owner-authorized", true);
  // put the ledger back as it was
  await page.getByTestId("budget-total").fill("0");
  await page.getByTestId("budget-daily").fill("0");
  await page.getByTestId("budget-phrase").fill("I authorize this spending");
  await page.getByTestId("budget-submit").click();
  await expect(page.getByTestId("authorized")).toHaveText("$0.00");
});

test("a visitor replays the published run from its record, and every epoch matches", async ({ page, request }, testInfo) => {
  test.skip(!HAS_DB, "needs TEST_DATABASE_URL: published runs are stored in PostgreSQL");
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const listed = (await (await request.get("/api/recordings")).json()) as { recordings: { id: string; title: string; provider: string }[] };
  const mine = listed.recordings.find((r) => r.title === `Mock society (${project})`);
  expect(mine, "the run published by the previous test is listed").toBeTruthy();
  expect(mine!.provider).toBe("mock");
  // what a visitor is given: the configuration, the tape and the digests — nothing about cost or scheduling
  const view = (await (await request.get(`/api/runs/${mine!.id}`)).json()) as { run: Record<string, unknown>; epochs: Record<string, unknown>[] };
  expect(Object.keys(view.epochs[0]!).sort()).toEqual(["alive", "digest", "epoch", "fromTick", "tape", "toTick"]);
  expect(view.run).not.toHaveProperty("reservedMicroUsd");

  await page.goto(`/?recording=${mine!.id}&q=low&pr=0.6`);
  const badge = page.getByTestId("recording-badge");
  await expect(badge).toBeVisible({ timeout: 90_000 });
  await expect(badge).toContainText("MOCK minds, a test double (not a language model)");
  await page.getByTestId("speed-5").click();
  await expect(page.getByTestId("recording-state")).toHaveText("ended: all 2 days matched the record", { timeout: 180_000 });
  await expect(badge).toHaveAttribute("data-state", "ended");
  // a recording is watched, not changed
  await expect(page.getByTestId("open-interventions")).toBeDisabled();
  await shot(page, project, "24-recording-published");
});

test("the bundled recording plays from the title screen and matches its record to the end", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const project = testInfo.project.name;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?q=low&pr=0.6");
  await page.getByTestId("title-recordings").click();
  const entry = page.getByTestId("recording-mock-first-light");
  await expect(entry).toBeVisible();
  await expect(page.getByTestId("recordings-list")).toContainText("MOCK minds · a deterministic test double, not a language model");
  await shot(page, project, "25-recordings-panel");
  await entry.click();
  const badge = page.getByTestId("recording-badge");
  await expect(badge).toBeVisible({ timeout: 90_000 });
  await expect(badge).toContainText("400 decisions replayed, nobody consulted");
  await page.getByTestId("speed-5").click();
  // the worker checks the world against the recorded digest at the end of each of the 24 epochs
  await expect(page.getByTestId("recording-state")).toHaveText("ended: all 6 days matched the record", { timeout: 300_000 });
  await expect(page.getByTestId("stat-date")).toContainText("Day 7");
  await shot(page, project, "26-recording-bundled-end");

  // who decided is said exactly: a recorded decision of a mock mind, or reflex between decisions — never "a language model"
  await clickCitizen(page, testInfo.project.name === "mobile");
  await expect(page.getByTestId("inspector-mind")).toHaveText(/^(Recorded decision by a MOCK mind \(a deterministic test double, not a language model\)|Acting on reflex until its mind is next consulted)/);
  // the banner stays readable beside an open sheet (on a phone the sheet rises from the bottom)
  const banner = (await badge.boundingBox())!;
  const sheet = (await page.getByTestId("inspector").boundingBox())!;
  const apart = banner.y + banner.height <= sheet.y + 1 || banner.x + banner.width <= sheet.x + 1 || sheet.x + sheet.width <= banner.x + 1;
  expect(apart, `the inspector covers the recording banner: ${JSON.stringify({ banner, sheet })}`).toBe(true);
  await shot(page, project, "27-recording-inspector");
  await page.getByTestId("inspector-close").click();
  // the menu says what this is, and offers no save
  await page.getByTestId("open-menu").click();
  await expect(page.getByTestId("menu")).toContainText("This is a recording (MOCK minds, a deterministic test double)");
  await expect(page.getByTestId("save-game")).toHaveCount(0);
  expect(errors).toEqual([]);
});
