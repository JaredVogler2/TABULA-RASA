import { expect, test, type Page } from "@playwright/test";
import { capture } from "./capture";
import { rowProblems, selectedCitizen, sight } from "./layout";

/**
 * Phase 04 gate: the complete offline loop with real clicks and taps.
 *
 *   title → scenario & seed → world → play / pause / step / speed → inspect a citizen →
 *   read the Chronicle → intervene (fork) → compare → save → reload → continue
 *
 * Runs against the production build with zero credentials. `?q=low` selects the low
 * graphics preset because CI renders WebGL in software; it changes drawing only.
 */

// Screenshots go to the (untracked) test output folder unless a phase's evidence is being recorded:
//   E2E_SHOTS=evidence/phase-04/e2e pnpm e2e

// JPEG keeps the committed evidence small; the test asserts on the DOM, never on pixels
const shot = (page: Page, project: string, name: string): Promise<void> => capture(page, project, name);

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
  const who = await selectedCitizen(page);
  expect(who, "the inspector is open on a citizen").not.toBeNull();
  const seen = () => sight(page, who!);
  /** Where the citizen is drawn once the camera has come to rest, having waited for nothing to stand over them. */
  const atRest = async (centered = false): Promise<{ x: number; y: number }> => {
    let last = { x: Number.NaN, y: Number.NaN };
    await expect
      .poll(
        async () => {
          const s = await seen();
          const moved = s.at ? Math.hypot(s.at.x - last.x, s.at.y - last.y) : Number.NaN;
          if (s.at) last = s.at;
          const inPlace = !centered || (s.fromMiddle >= 0 && s.fromMiddle < 40);
          return s.under === "" && moved < 1.5 && inPlace
            ? "at rest in sight"
            : `under "${s.under}", moved ${moved}, ${s.fromMiddle}px from the uncovered middle`;
        },
        { message: "the citizen comes to rest where they can be seen", timeout: 30_000, intervals: [500] },
      )
      .toBe("at rest in sight");
    return last;
  };
  const away = (from: { x: number; y: number }, to: { x: number; y: number } | null): number => (to ? Math.hypot(to.x - from.x, to.y - from.y) : Number.POSITIVE_INFINITY);
  if (touch) {
    // On a phone the card is a sheet over the map. It opens drawn back to its head, and the camera turns to whoever
    // was tapped: they are still to be seen, above their card. (The sheet used to open at its full height, over them.)
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-compact", "true");
    await atRest();
    await shot(page, project, "05a-tapped-in-sight");
    // its arrow opens the whole card, and draws it back again; so does a tap on its head
    await page.getByTestId("inspector-toggle").click();
    await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-compact", "true");
    await expect(page.getByTestId("inspector-toggle")).toHaveAccessibleName("Draw the card back");
    await page.getByTestId("inspector-toggle").click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-compact", "true");
    await expect(page.getByTestId("inspector-toggle")).toHaveAccessibleName("Open the whole card");
    // …and a tap on its head, as a finger makes it, eases it open: the browser itself reports a transition of
    // the card's height. (Letting go of the head used to put the card's own easing aside for a fifth of a
    // second, so a tapped card jumped open while one opened by its arrow did not. No picture taken here could
    // show the difference: this machine draws about four frames a second.)
    await page.getByTestId("inspector").evaluate((el) => {
      const seen: string[] = [];
      (window as unknown as { __eased: string[] }).__eased = seen;
      el.addEventListener("transitionrun", (e) => {
        if (e.target === el) seen.push((e as TransitionEvent).propertyName);
      });
    });
    await page.getByTestId("inspector-name").tap();
    await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-compact", "true");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __eased: string[] }).__eased), { message: "a tapped card eases open: its height is in transition", timeout: 10_000 }).toContain("max-height");
  } else {
    // at the side of a wide screen the card is always whole, and has no arrow
    await expect(page.getByTestId("inspector-toggle")).toBeHidden();
  }

  // ── follow: the person followed is held where they can be seen, and stays there as they walk.
  // (This is the owner's report from a real phone: "Following a person doesn't seem to move the camera and track
  // them." The camera held whoever it followed at the middle of the canvas; on a phone the middle of the canvas
  // was behind the card. The button said "Following" — which was all this test looked at.)
  const follow = page.getByTestId("follow");
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  // following is for watching: a card that was open in full draws back
  if (touch) await expect(page.getByTestId("inspector")).toHaveAttribute("data-compact", "true");
  const home = await atRest(true);
  const held = await seen();
  expect(held.under, "nothing stands over the person followed").toBe("");
  expect(held.fromMiddle, `the person followed is drawn at the middle of the uncovered map (${JSON.stringify(held)})`).toBeLessThan(40);
  await shot(page, project, "05-inspect-citizen");

  // Dragging the map away lets go of them, and the button says so…
  await page.mouse.move(home.x, home.y + 30);
  await page.mouse.down();
  await page.mouse.move(home.x + 120, home.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => away(home, (await seen()).at), { message: "the drag moved the map, and the person with it", timeout: 20_000 }).toBeGreaterThan(80);
  // …and Follow brings the camera back to them: this is the camera moving, not a button changing its word
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => away(home, (await seen()).at), { message: "Follow brings the person back to where a followed person is held", timeout: 30_000 }).toBeLessThan(12);

  // Zooming is not looking elsewhere: it keeps the follow (it used to end it without a word)
  await page.mouse.move(home.x, home.y + 30);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(1200);
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => away(home, (await seen()).at), { message: "zoomed in, the person followed is still where they were held", timeout: 20_000 }).toBeLessThan(16);
  const kept = await atRest();

  // With time running they walk, and the camera goes with them: sampled for a quarter of a day, they are never
  // under a bar or the card, and never far from where they are held.
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "true");
  const walkedFrom = await tick(page);
  const lost: string[] = [];
  let samples = 0;
  let furthest = 0;
  while ((await tick(page)) < walkedFrom + 24 || samples < 8) {
    const s = await seen();
    const drift = away(kept, s.at);
    samples++;
    furthest = Math.max(furthest, drift);
    if (s.under !== "" || drift > 70) lost.push(`tick ${await tick(page)}: ${s.at ? `drawn at (${Math.round(s.at.x)}, ${Math.round(s.at.y)}), ${Math.round(drift)}px from where they are held` : "not in the picture"}${s.under ? `, under "${s.under}"` : ""}`);
    if (samples > 400) break;
    await page.waitForTimeout(250);
  }
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
  testInfo.annotations.push({ type: "follow", description: `${project}: ${samples} samples over ${(await tick(page)) - walkedFrom} ticks at 8×; furthest from where they are held: ${Math.round(furthest)}px` });
  expect(lost, "the person followed stays in sight, where they are held, while time runs").toEqual([]);
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  // what the button says is what the camera is doing
  expect(await page.evaluate(() => window.__tr?.following()), "the camera is following").toBe(true);
  await shot(page, project, "05b-followed-while-walking");

  // Choosing someone else lets go of the first: the card, its button and the camera are all about the second.
  // (The button went back to "Follow" and the camera went on tracking the first person.) Zoomed out — which
  // keeps the follow — so that there is someone else to choose.
  const held2 = (await seen()).at!;
  await page.mouse.move(held2.x, held2.y + 30);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(80);
  }
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  let other: number | null = null;
  for (let attempt = 0; attempt < 12 && (other === null || other === who); attempt++) {
    const target = await page.evaluate((first) => {
      const canvas = document.querySelector('[data-testid="world-canvas"]');
      const mine = window.__tr?.screenOf(first) ?? null;
      for (let id = 0; id < 50; id++) {
        if (id === first) continue;
        const p = window.__tr?.screenOf(id);
        if (!p || document.elementFromPoint(p.x, p.y) !== canvas) continue;
        // well clear of the person followed, so that a tap cannot be taken for them
        if (mine && Math.hypot(p.x - mine.x, p.y - mine.y) < 48) continue;
        return p;
      }
      return null;
    }, who!);
    if (target) {
      if (touch) await page.touchscreen.tap(target.x, target.y);
      else await page.mouse.click(target.x, target.y);
    }
    await page.waitForTimeout(700);
    other = await selectedCitizen(page);
  }
  expect(other, "someone else was chosen").not.toBeNull();
  expect(other, "someone else was chosen").not.toBe(who);
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__tr?.following()), "the camera has let go of the first person").toBe(false);
  await page.getByTestId("inspector-close").click();
  await expect(page.getByTestId("inspector")).toHaveCount(0);

  // ── the Chronicle lists logged events; an entry jumps to where it happened
  await page.getByTestId("open-chronicle").click();
  await expect(page.getByTestId("chronicle")).toBeVisible();
  const entries = page.getByTestId("chronicle-entries").locator("li");
  expect(await entries.count()).toBeGreaterThan(0);
  await shot(page, project, "06-chronicle");
  await entries.first().locator("button").click();
  if (!touch) {
    // An entry about a citizen chooses them. Follow them, then go to that entry again: the camera is sent to
    // where it happened, so it is following nobody — and the button must not go on saying that it is. (For
    // forty minutes between two merges it did: choosing the same citizen again had been made to keep the
    // follow, without asking whether the camera still had them.)
    const jump = page.getByTestId("chronicle-entries").locator('button[title="Go to where this happened"]');
    let chosen: number | null = null;
    let at = -1;
    for (let i = 0; i < Math.min(await jump.count(), 30) && chosen === null; i++) {
      await jump.nth(i).click();
      await page.waitForTimeout(300);
      chosen = await selectedCitizen(page);
      at = i;
    }
    expect(chosen, "a Chronicle entry chose a citizen").not.toBeNull();
    const followFromHere = page.getByTestId("follow");
    await followFromHere.click();
    await expect(followFromHere).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.__tr?.following()), "the camera is following them").toBe(true);
    await jump.nth(at).click();
    await page.waitForTimeout(400);
    expect(await selectedCitizen(page), "the same citizen is still chosen").toBe(chosen);
    expect(await page.evaluate(() => window.__tr?.following()), "the camera was sent to the place: it is following nobody").toBe(false);
    await expect(followFromHere, "and the button does not say that it is").toHaveAttribute("aria-pressed", "false");
  }
  await page.getByTestId("chronicle-close").click();
  if (await page.getByTestId("inspector-close").count()) await page.getByTestId("inspector-close").click();

  // ── intervene: history forks
  await page.getByTestId("open-interventions").click();
  await expect(page.getByTestId("interventions")).toBeVisible();
  await shot(page, project, "07-interventions");
  // A notice is where it will stay from the first frame it is drawn. (Its entry used to draw it half its
  // width to the right of the centre while it faded in, and it jumped to the middle when the fade was done;
  // a still never shows that, so the first frame is measured.) No earlier notice may be on the page: one that
  // only changes its words does not enter again.
  await expect(page.getByTestId("toast")).toHaveCount(0, { timeout: 15_000 });
  const firstFrame = page.evaluate(
    () =>
      new Promise<{ centre: number; screen: number }>((resolve) => {
        const seen = (): boolean => {
          const el = document.querySelector('[data-testid="toast"]');
          if (!el) return false;
          const box = el.getBoundingClientRect();
          resolve({ centre: (box.left + box.right) / 2, screen: window.innerWidth / 2 });
          return true;
        };
        const watch = new MutationObserver(() => {
          if (seen()) watch.disconnect();
        });
        watch.observe(document.body, { childList: true, subtree: true });
        // if no notice is ever added, say so instead of waiting for ever
        setTimeout(() => resolve({ centre: -1, screen: -1 }), 60_000);
      }),
  );
  await page.getByTestId("intervene-blight").click();
  await expect(page.getByTestId("forked-badge")).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("forked");
  const entered = await firstFrame;
  expect(entered.screen, "the notice was seen being added to the page").toBeGreaterThan(0);
  expect(Math.abs(entered.centre - entered.screen), `the notice enters at the centre (${entered.centre} of ${entered.screen})`).toBeLessThanOrEqual(2);
  // a notice is said above the time controls, never over them (on a phone the bar is two rows tall, and a
  // notice used to cover its step button and its clock, by 47 px)
  const notice = await page.getByTestId("toast").boundingBox();
  const timeControls = await page.getByRole("group", { name: "Time controls" }).boundingBox();
  expect(notice, "the notice is on the page").not.toBeNull();
  expect(timeControls, "the time controls are on the page").not.toBeNull();
  expect((notice?.y ?? 0) + (notice?.height ?? 0), "the notice ends above the time controls").toBeLessThanOrEqual(timeControls?.y ?? 0);

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

  // ── the aim on the scenario's card is now counted in both worlds: the one touched and the one left alone
  await page.getByTestId("open-atlas").click();
  await expect(page.getByTestId("aim-text")).toHaveText("See four in five through the first winter.");
  await expect(page.getByTestId("aim-yours-state")).toHaveText(/^(Open|Met on day \d+|Lost on day \d+)$/);
  await expect(page.getByTestId("aim-twin")).toBeVisible();
  await expect(page.getByTestId("aim-twin-state")).toHaveText(/^(Open|Met on day \d+|Lost on day \d+)$/);
  await expect(page.getByTestId("aim-no-twin")).toHaveCount(0);
  await shot(page, project, "08b-aim-in-both-worlds");
  await page.getByTestId("atlas-close").click();

  // ── save, reload the page, continue exactly where we were
  const savedTick = await tick(page);
  await page.getByTestId("open-menu").click();
  await page.getByTestId("save-game").click();
  await expect(page.getByTestId("toast")).toContainText("Saved");
  await expect(page.getByTestId("save-list")).toBeVisible();
  expect(await rowProblems(page, "save-list"), "the list of saved worlds is whole").toEqual([]);
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

test("lists of rows are whole from the smallest phone to a desktop: the Recordings sheet", async ({ page }, testInfo) => {
  // The owner's phone showed this sheet with the name of the recording broken one word to a line in a sliver at
  // the left, and the rest of the row running off the right edge. Every row list in the product shares the
  // style; this one is on the title screen, the first thing a visitor can open.
  const project = testInfo.project.name;
  const sizes: [number, number][] = project === "mobile" ? [[320, 568], [360, 740], [390, 844], [430, 932]] : [[768, 1024], [1024, 768], [1366, 768]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.goto("/?q=low&pr=0.4");
    await page.getByTestId("title-recordings").click();
    await expect(page.getByTestId("recordings-list")).toBeVisible();
    expect(await rowProblems(page, "recordings-list"), `the Recordings list at ${width}×${height}`).toEqual([]);
    // the name of a recording is something to press: it is in sight, inside the sheet
    const entry = (await page.getByTestId("recording-mock-first-light").boundingBox())!;
    const sheet = (await page.getByTestId("recordings").boundingBox())!;
    expect(entry.x, "the name starts inside the sheet").toBeGreaterThanOrEqual(sheet.x);
    expect(entry.x + entry.width, "the name ends inside the sheet").toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
    if (width === 390 || width === 1366) await shot(page, project, `11-recordings-${width}`);
  }
});

/** Press Tab until the element with this test id has the focus. No pointer is involved. */
async function tabTo(page: Page, testId: string, limit = 90): Promise<void> {
  for (let i = 0; i < limit; i++) {
    const at = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? "");
    if (at === testId) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached "${testId}"`);
}

test("the keyboard alone can drive the game: every key it reads, and never a pointer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard path is a desktop concern");
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const key = (k: string) => page.keyboard.press(k);
  const pressed = (id: string) => page.getByTestId(id);
  const where = async (agent: number): Promise<{ x: number; y: number }> => (await page.evaluate((a) => window.__tr?.screenOf(a) ?? null, agent)) ?? { x: Number.NaN, y: Number.NaN };

  // from the title to a world: Tab and Enter only
  await page.goto("/?q=low&pr=0.6");
  await expect(page.getByTestId("begin")).toBeVisible();
  await tabTo(page, "begin");
  await key("Enter");
  await expect(page.getByTestId("setup")).toBeVisible();
  await tabTo(page, "create-world");
  await key("Enter");
  await expect(page.getByTestId("world-label")).toHaveText(/ · seed \d+$/, { timeout: 60_000 });
  await tabTo(page, "coach-skip");
  await key("Enter");
  await expect(page.getByTestId("coach")).toHaveCount(0);

  // time: one tick, each of the six speeds, play and pause
  await key(".");
  await expect.poll(() => tick(page)).toBe(1);
  for (let n = 1; n <= 6; n++) {
    await key(String(n));
    await expect(pressed(`speed-${n - 1}`)).toHaveAttribute("aria-checked", "true");
  }
  await key("5");
  await key(" ");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "true");
  // far enough for the Chronicle to have something in it
  await expect.poll(() => tick(page), { timeout: 120_000 }).toBeGreaterThan(60);
  await key(" ");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");

  // the view: every pan, turn and zoom key moves it (a citizen who is standing still is seen somewhere else)
  for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "d", "w", "s", "q", "e", "+", "-", "=", "_"]) {
    const before = await where(0);
    expect(Number.isFinite(before.x), `citizen 0 has a place on screen before "${k}"`).toBe(true);
    await key(k);
    await expect
      .poll(async () => {
        const now = await where(0);
        return Math.hypot(now.x - before.x, now.y - before.y);
      }, { message: `"${k}" moves the view`, timeout: 10_000 })
      .toBeGreaterThan(1);
  }
  // letters mean the same with Shift held
  const beforeShift = await where(0);
  await key("Shift+KeyA");
  await expect.poll(async () => Math.hypot((await where(0)).x - beforeShift.x, (await where(0)).y - beforeShift.y), { timeout: 10_000 }).toBeGreaterThan(1);

  // the Chronicle, and through it a citizen: an entry is a button, and pressing it goes there and selects who did it
  await key("c");
  await expect(page.getByTestId("chronicle")).toBeVisible();
  let selected = false;
  for (let i = 0; i < 120 && !selected; i++) {
    await key("Tab");
    const onEntry = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && !!el.closest('[data-testid="chronicle-entries"]') && el.title === "Go to where this happened";
    });
    if (!onEntry) continue;
    await key("Enter");
    selected = await page
      .getByTestId("inspector-name")
      .waitFor({ state: "visible", timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
  }
  expect(selected, "a Chronicle entry, reached by Tab and pressed with Enter, selects a citizen").toBe(true);

  // with someone selected: follow, what they know, whom they know — each on and off by its key
  for (const [k, id] of [["f", "follow"], ["v", "overlay-knowledge"], ["t", "overlay-ties"]] as const) {
    await key(k);
    await expect(pressed(id), `"${k}" on`).toHaveAttribute("aria-pressed", "true");
    await key(k);
    await expect(pressed(id), `"${k}" off`).toHaveAttribute("aria-pressed", "false");
  }
  // Escape closes the open panel first, then lets go of the citizen
  await key("Escape");
  await expect(page.getByTestId("chronicle")).toHaveCount(0);
  await expect(page.getByTestId("inspector")).toBeVisible();
  await key("Escape");
  await expect(page.getByTestId("inspector")).toHaveCount(0);

  // every panel that has a key opens by it and closes with Escape
  for (const [k, panel] of [["i", "interventions"], ["g", "civics"], ["l", "atlas"], ["h", "history"], ["j", "journal"], ["Shift+KeyG", "civics"]] as const) {
    await key(k);
    await expect(page.getByTestId(panel), `"${k}" opens ${panel}`).toBeVisible();
    await key("Escape");
    await expect(page.getByTestId(panel)).toHaveCount(0);
  }

  // Compare and the twin have no key until there is a fork; an intervention is a button like any other
  await key("k");
  await expect(page.getByTestId("compare")).toHaveCount(0);
  await key("i");
  await expect(page.getByTestId("interventions")).toBeVisible();
  await tabTo(page, "intervene-rain");
  await key("Enter");
  await expect(page.getByTestId("forked-badge")).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId("interventions").count()) await key("Escape");
  await key("k");
  await expect(page.getByTestId("compare")).toBeVisible();
  await key("Escape");
  await expect(page.getByTestId("compare")).toHaveCount(0);
  await key("x");
  await expect(pressed("view-twin")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("twin-badge")).toBeVisible();
  await key("x");
  await expect(pressed("view-twin")).toHaveAttribute("aria-pressed", "false");

  // sound by key: on, then off (nothing plays before the first press)
  await key("m");
  await expect(pressed("toggle-sound")).toHaveAttribute("aria-pressed", "true");
  await key("m");
  await expect(pressed("toggle-sound")).toHaveAttribute("aria-pressed", "false");

  // the menu has no key: it is reached by Tab and opened by Enter like any button
  await tabTo(page, "open-menu");
  await key("Enter");
  await expect(page.getByTestId("menu")).toBeVisible();
  await key("Escape");
  await expect(page.getByTestId("menu")).toHaveCount(0);
  expect(errors, "page errors").toEqual([]);
});

test("charters are shown in plain words, with how they came about", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on desktop; the panel is the same sheet component");
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/?q=low&pr=0.6");
  await page.getByTestId("begin").click();
  await page.getByTestId("scenario-first_light").click();
  await page.getByTestId("seed-input").fill("1");
  // the scripted control arm guarantees that a charter is offered, and must be labelled as not emergent
  await page.getByTestId("institutions-select").selectOption("scripted_control");
  await page.getByTestId("create-world").click();
  await expect(page.getByTestId("world-label")).toHaveText(/ · seed \d+$/, { timeout: 60_000 });
  await page.getByTestId("coach-skip").click();

  // before anything has been proposed the panel says so
  await page.getByTestId("open-civics").click();
  await expect(page.getByTestId("civics")).toBeVisible();
  await expect(page.getByTestId("civics-mode")).toContainText("cannot write charters");
  await expect(page.getByTestId("civics-empty")).toBeVisible();
  await page.getByTestId("civics-close").click();

  // The world is taken to a known moment by single steps, a quarter of a day at a time, until the top bar
  // counts a charter. Steps land exactly, on any machine: in this world that is tick 624, on the seventh day,
  // with the charter that was offered at tick 601 still on offer.
  //
  // This used to play at the fastest speed until the count appeared and then press pause — and where a world
  // stops then depends on how long the press takes. In this world the scripted charter lapses unsigned every
  // three and a quarter days and is offered again a quarter of a day later, until it is signed on day 33; for
  // those quarter days nothing is on offer or in force, and the lapsed charter is folded away under "Lapsed and
  // ended". A slow runner once stopped the world inside one of them, on day 19, more than nine seconds after
  // the first offer (CI run 45704267429: the first charter on the page was the lapsed `charter-157`, hidden;
  // `evidence/after-20/charters-test.txt`), and the test failed for where the world happened to stop, not for
  // anything the panel did.
  //
  // The step button is pressed from inside the page, a quarter of a day's presses at a time: one real press
  // takes most of a second where the picture is drawn in software, and six hundred are wanted. (A real press of
  // the same button, and of its key, is in the two tests above.)
  const QUARTER_DAY = 24;
  const stepQuarterDay = (): Promise<void> =>
    page.evaluate((presses) => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="step-tick"]');
      if (!button) throw new Error("the step button is not on the page");
      for (let i = 0; i < presses; i++) button.click();
    }, QUARTER_DAY);
  let stepped = await tick(page);
  expect(stepped, "a new world starts paused at its first tick").toBe(0);
  for (let quarters = 0; quarters < 4 * 12 && !(await page.getByTestId("civics-count").isVisible()); quarters++) {
    await stepQuarterDay();
    stepped += QUARTER_DAY;
    await expect.poll(() => tick(page), { timeout: 60_000 }).toBe(stepped);
  }
  await expect(page.getByTestId("civics-count"), `a charter is counted by tick ${stepped}`).toBeVisible();
  await page.getByTestId("open-civics").click();
  const charter = page.locator('[data-testid^="charter-"]').first();
  await expect(charter).toBeVisible();
  await expect(charter).toHaveAttribute("data-state", "proposed");
  await expect(charter).toContainText(/larder/i); // "Common larder", or "Hearth and larder" where a fire stands by the store
  await expect(charter).toContainText("Scripted control · not emergence");
  await expect(charter).toContainText("must put 1 food into the common stock");
  await expect(charter).toContainText("Anyone may leave at any time");
  await shot(page, testInfo.project.name, "11-charters");
  await page.getByTestId("civics-close").click();

  // the Chronicle has a filter for agreements and shows the proposal with its origin
  await page.getByTestId("open-chronicle").click();
  await page.getByRole("button", { name: "Agreements" }).click();
  await expect(page.getByTestId("chronicle-entries")).toContainText("a scripted control charter");
  expect(errors, "console errors").toEqual([]);
});

