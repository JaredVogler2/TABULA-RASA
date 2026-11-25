import { expect, test, type Page } from "@playwright/test";
import { capture } from "./capture";

/**
 * Phase 15: what the game does when things are not ideal. Two tabs of one browser. Each has a world of its own, and there is one autosave
 * slot. The first tab to need it keeps it; the second says so and never overwrites it; when
 * the first tab closes, the second takes it up at its next second morning. Also here: the
 * autosave is written at the fastest speed (it used to wait for a frame that landed exactly
 * on midnight, which at 64× most frames do not); a hidden tab stops time, keeps what there is
 * and starts again when it is seen; and a stored save that has been altered is refused
 * without changing the world on screen.
 */

async function tick(page: Page): Promise<number> {
  const text = (await page.getByTestId("tick").textContent()) ?? "";
  return Number(text.replace(/\D+/g, ""));
}

/**
 * From the title to a paused new world. `firstTime` says whether this browser has been through the
 * first steps before: skipping them is remembered (in the browser's settings, so in every tab), and
 * a second world, in the same tab or another, starts without them.
 */
async function begin(page: Page, seed: string, address = "/?q=low&pr=0.4", firstTime = true): Promise<void> {
  await page.goto(address);
  await page.getByTestId("begin").click();
  await page.getByTestId("scenario-first_light").click();
  await page.getByTestId("seed-input").fill(seed);
  await page.getByTestId("create-world").click();
  await expect(page.getByTestId("world-label")).toHaveText(`First Light · seed ${seed}`, { timeout: 60_000 });
  if (firstTime) await page.getByTestId("coach-skip").click();
  else await expect(page.getByTestId("coach")).toHaveCount(0);
}

async function playPast(page: Page, target: number): Promise<void> {
  await page.getByTestId("speed-5").click();
  if ((await page.getByTestId("play-toggle").getAttribute("data-playing")) !== "true") await page.getByTestId("play-toggle").click();
  await expect.poll(() => tick(page), { timeout: 240_000 }).toBeGreaterThan(target);
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
}

interface Stored {
  seed: number;
  day: number;
  tick: number;
  hash: string;
}

/**
 * After playing at the fastest speed and pausing: the slot holds this seed's world as it was on one
 * of the last second mornings. Which one cannot be fixed in advance — on a slow renderer the world
 * runs on while the test's own click waits its turn — so it is read off where the world stopped:
 * an even day, not after today, and no more than one autosave behind. (That the slot is not simply
 * the first autosave ever made is the point: at the fastest speed they must keep being written.)
 */
async function expectRecentAutosave(page: Page, seed: number): Promise<Stored> {
  const today = Math.floor((await tick(page)) / 96);
  expect(today, "the world has reached its third morning").toBeGreaterThanOrEqual(2);
  await expect
    .poll(
      async () => {
        const s = await autosave(page);
        return s !== null && s.seed === seed && s.day % 2 === 0 && s.day >= Math.max(2, today - 3) && s.day <= today;
      },
      { timeout: 30_000, message: `an autosave of seed ${seed} from one of the last second mornings before day ${today}` },
    )
    .toBe(true);
  return (await autosave(page)) as Stored;
}

/** The tick, a little into the next second morning after now: playing past it must write an autosave. */
async function pastNextSecondMorning(page: Page): Promise<number> {
  const today = Math.floor((await tick(page)) / 96);
  return (today - (today % 2) + 2) * 96 + 8;
}

/** Tell the page its tab was hidden or shown, the way the browser does: the state changes, then the event fires. */
function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  return page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => s === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

/** What is in the autosave slot, read from the browser's own storage. */
function autosave(page: Page): Promise<Stored | null> {
  return page.evaluate(
    () =>
      new Promise<Stored | null>((resolve) => {
        const open = indexedDB.open("tabula-rasa");
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("saves")) {
            db.close();
            resolve(null);
            return;
          }
          const get = db.transaction("saves", "readonly").objectStore("saves").get("autosave");
          get.onerror = () => resolve(null);
          get.onsuccess = () => {
            const r = get.result as Stored | undefined;
            db.close();
            resolve(r ? { seed: r.seed, day: r.day, tick: r.tick, hash: r.hash } : null);
          };
        };
      }),
  );
}

test("two tabs share one autosave slot without overwriting each other, and an altered save is refused", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one browser with two tabs: run once");
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  // ── the first tab: at the fastest speed, the third morning is autosaved
  await begin(page, "7");
  expect(await autosave(page)).toBeNull();
  await playPast(page, 200);
  const first = await expectRecentAutosave(page, 7);
  expect(first.hash).toMatch(/^[0-9a-f]{64}$/);

  // ── nobody is watching: the tab is hidden. Time stops, the moment is kept, and time starts again when the tab is seen
  await page.getByTestId("speed-2").click();
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "true");
  await setVisibility(page, "hidden");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
  const hiddenAt = await tick(page);
  await expect.poll(async () => (await autosave(page))?.tick, { timeout: 30_000 }).toBe(hiddenAt);
  await page.waitForTimeout(1500);
  expect(await tick(page)).toBe(hiddenAt);
  await setVisibility(page, "visible");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "true");
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(hiddenAt);
  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");
  // a tab that was paused when it was hidden stays paused when it is seen
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await page.waitForTimeout(600);
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("data-playing", "false");

  // ── the second tab has a world of its own; it is told that it is not autosaved, and the slot is left alone
  const second = await context.newPage();
  second.on("pageerror", (err) => errors.push(String(err)));
  await begin(second, "9", undefined, false);
  // The notice is said once, at the second tab's second morning, and stays for five seconds. On a slow renderer
  // the click that pauses the world can take longer than that to land, so it is watched for from before the
  // world plays. (It used to be looked for afterwards — and was found replaced by "Field journal · A gift":
  // news could take a notice's place. Now it cannot: src/ui/game/toasts.ts.)
  const told = second.getByTestId("toast").filter({ hasText: "Another tab is keeping the autosave" }).waitFor({ state: "visible", timeout: 240_000 });
  await playPast(second, 200);
  await told;
  expect((await autosave(second))?.seed).toBe(7);
  await second.getByTestId("open-menu").click();
  await expect(second.getByTestId("autosave-elsewhere")).toBeVisible();
  await capture(second, "desktop", "60-autosave-held-by-another-tab");
  // saving by hand still works there, under its own name
  await second.getByTestId("save-game").click();
  await expect(second.getByTestId("toast")).toContainText("Saved");
  expect((await autosave(second))?.seed).toBe(7);
  await second.getByTestId("menu-close").click();

  // ── the first tab closes; the lock goes with it, and the second tab's next second morning is autosaved
  await page.close();
  await playPast(second, await pastNextSecondMorning(second));
  await expectRecentAutosave(second, 9);
  await second.getByTestId("open-menu").click();
  await expect(second.getByTestId("autosave-elsewhere")).toHaveCount(0);

  // ── a stored save whose text was altered is refused, and the world on screen stays
  const before = await tick(second);
  const altered = await second.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("tabula-rasa");
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          const store = db.transaction("saves", "readwrite").objectStore("saves");
          const get = store.get("autosave");
          get.onsuccess = () => {
            // saves are kept gzip-compressed: one byte in the middle of the stream is changed
            const r = get.result as { packed?: { snapshot: Uint8Array; control: Uint8Array | null } | null } & Record<string, unknown>;
            if (!r.packed) {
              resolve(false);
              return;
            }
            const bytes = new Uint8Array(r.packed.snapshot);
            const at = Math.floor(bytes.length / 2);
            bytes[at] = (bytes[at] as number) ^ 0x55;
            r.packed = { snapshot: bytes, control: r.packed.control };
            const put = store.put(r);
            put.onsuccess = () => {
              db.close();
              resolve(bytes.length > 1000);
            };
            put.onerror = () => resolve(false);
          };
          get.onerror = () => resolve(false);
        };
      }),
  );
  expect(altered).toBe(true);
  await second.getByTestId("load-autosave").click();
  await expect(second.getByTestId("toast")).toContainText("damaged and was not loaded");
  await expect(second.getByTestId("world-label")).toHaveText("First Light · seed 9");
  expect(await tick(second)).toBe(before);

  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("a renderer that cannot keep up is simplified once, says so, and changes nothing in the world", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the software renderer is the slow device here: run once");
  // Ten minutes, like the two-tabs test. It asks a software renderer for more than it can draw, on purpose, and
  // then steps two worlds by hand: on a busy machine that has taken a little over five minutes (the whole-suite
  // run in a clean checkout timed out here at 300 s with the first world done and the second half way).
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  // No preset and no resolution cap in the address: the automatic choice, on a renderer that cannot keep up with
  // it. The island is already being drawn behind the title, so the choice is read at once and the word about
  // simplifying is listened for from the start: on this renderer it can come before a world has even been made.
  await page.goto("/");
  await page.waitForFunction(() => {
    const s = window.__tr?.stats() as { quality?: string } | null | undefined;
    return typeof s?.quality === "string";
  });
  const before = (await page.evaluate(() => window.__tr?.stats())) as { quality: string; pixelRatio: number };
  expect(["medium", "high"]).toContain(before.quality);
  // first the internal resolution steps down, then — still slow at the lowest — the preset does, with a word about it
  const said = page.getByTestId("toast").filter({ hasText: "The picture was simplified to keep it moving" }).waitFor({ state: "visible", timeout: 240_000 });
  await page.getByTestId("begin").click();
  await page.getByTestId("scenario-first_light").click();
  await page.getByTestId("seed-input").fill("7");
  await page.getByTestId("create-world").click();
  await expect(page.getByTestId("world-label")).toHaveText("First Light · seed 7", { timeout: 60_000 });
  await page.getByTestId("coach-skip").click();
  const at = await tick(page);
  await said;
  const after = (await page.evaluate(() => window.__tr?.stats())) as { quality: string; pixelRatio: number };
  expect(after.quality).toBe(before.quality === "high" ? "medium" : "low");
  // the setting itself is still "automatic": nothing was chosen on the visitor's behalf for next time
  await page.getByTestId("open-menu").click();
  await expect(page.getByTestId("setting-quality")).toHaveValue("auto");
  await capture(page, "desktop", "61-picture-simplified");
  await page.getByTestId("menu-close").click();
  // the world never moved: it was paused before, and how it is drawn is not something it knows about
  expect(await tick(page)).toBe(at);
  await page.getByTestId("step-tick").click();
  await expect.poll(() => tick(page)).toBe(at + 1);

  // And what happens in it is the same whatever it is drawn with. Six hours on, this world — simplified,
  // at the lowest resolution — is hash for hash the world of another browser that drew the same seed with
  // the simplest preset from the start and never had to adapt. (The hash is the one a save carries: the
  // SHA-256 of the whole state. Hiding a tab writes the autosave.)
  const HOURS = 24;
  const sixHoursOn = async (p: Page): Promise<Stored> => {
    const from = await tick(p);
    for (let i = from; i < HOURS; i++) {
      await p.getByTestId("step-tick").click();
      await expect.poll(() => tick(p)).toBe(i + 1);
    }
    await setVisibility(p, "hidden");
    await expect.poll(async () => (await autosave(p))?.tick, { timeout: 30_000 }).toBe(HOURS);
    return (await autosave(p)) as Stored;
  };
  const simplified = await sixHoursOn(page);
  const other = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    const plain = await other.newPage();
    plain.on("pageerror", (err) => errors.push(String(err)));
    await begin(plain, "7");
    expect(((await plain.evaluate(() => window.__tr?.stats())) as { quality: string }).quality).toBe("low");
    const reference = await sixHoursOn(plain);
    expect(reference.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(simplified).toEqual(reference);
  } finally {
    await other.close();
  }

  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});
