# Performance, scale and resilience (phase 15)

2026-11-25. What was measured, on what, by which command; what the thresholds are and what happens when a
device does not meet them. Raw output is in `evidence/phase-15/`.

**Read this first.** Every number here describes the machine it was measured on: a cloud container with four
cores of an Intel Xeon at 2.3 GHz, no graphics chip, Node 22, headless Chromium drawing the 3D view with a
software rasterizer. The simulation figures (ticks a second, time per tick, save sizes, the ledger) do not
depend on a graphics chip and transfer to other machines roughly as their processors compare. **The frame
times do not transfer at all**: they measure a software renderer, and say nothing about a phone or a laptop.
No physical device has run this application, and no frame rate is claimed for any.

## Thresholds

Written down before the browser, load and request measurements below were taken on the final build. (The
five-day headless benchmark had been run before; its thresholds were set knowing roughly where it stood.)
Two of them were not met when first measured, and each led to a fix: P2 was 13 ticks a second over twenty
days, and P3 was 119.

| # | What | Threshold | Why this number | Measured | Met |
|---|---|---|---|---|---|
| P1 | Headless engine, reference world (50 people, planner minds) | ≥ 512 ticks a second | Four times the 128 the fastest speed asks for | 3,244 over five days; 1,070–1,579 over twenty | yes |
| P2 | Headless engine, 500 people on a 128 × 128 island | ≥ 32 ticks a second (16× speed) | A stress population should still be watchable | 234 over five days; 97–102 over twenty (13 before the fix described below) | yes, after the fix |
| P3 | In a browser worker, reference world, fastest speed | ≥ 120 of the 128 ticks a second asked, while the page draws | The fastest speed should be the speed it says | 128 in a desktop window and 121 in a phone's, over twenty seconds beside a software renderer (119 and 119 before a fix described below); 127.8 with no browser at all | yes, after the fix |
| P4 | Time for one tick in the worker, reference world | p95 ≤ 4 ms | Half of a 128-a-second budget, leaving room for frames to be sent | p95 1.6–2.4 ms | yes |
| P5 | A question to the worker (inspect a citizen) while it runs flat out | ≤ 100 ms | An inspector that opens "at once" | 0.4–1.8 s as seen by the page, which was inside a frame that long; the worker answers in 1–6 ms | **no, and it cannot be judged here** |
| P6 | A save of the reference world, as stored | ≤ 512 KB and ≤ 500 ms | Autosave every second day must not be felt | 262–325 KB; 0.33–0.52 s at the simplest preset and 1.0–1.6 s at the others (one or two of this renderer's frames); 0.08 s headless | size yes; time **no** in this browser (three of four runs at the simplest preset, none at the others) |
| P7 | Memory, reference world: page and worker JavaScript heaps | ≤ 256 MB each | A mid-range phone's tab | page 26–48 MB (up to 88 MB with 100 people); a worker's heap is not reported by the browser (headless: 21 MB) | yes, for what can be read |
| P8 | Frame time on a device with a graphics chip | p95 ≤ 33 ms at the automatic preset | Thirty frames a second as the floor | **not measurable here** | **NOT RUN** |
| P9 | Budget ledger under contention, 32 workers | reservation p95 ≤ 50 ms; nothing over-reserved at any sampled moment; no lost transaction | The ledger must not be the reason a step runs out of time | p95 38 ms; never; none. Through a transaction pooler on the same machine: p95 58 ms; never; none | yes straight to the server; **the time is not met through a pooler** (the two that matter — never over-reserved, nothing lost — are) |
| P10 | The server's public routes, one request at a time on loopback | p95 ≤ 50 ms | A visitor's page should not wait on the server | p95 2.9–4.6 ms (2.6–8.4 ms with the database behind a pooler) | yes |

## What happens below the thresholds

Nothing here changes the simulation: every fallback changes how the world is drawn or how often, never what
happens in it. The world runs in a worker and the renderer only reads what the worker sends.

1. **Frames slower than 42 ms for three seconds** (below about 24 a second): the renderer lowers its pixel
   ratio by 0.2, and again every three slow seconds, down to 0.6 device pixels per CSS pixel (`adapt` in
   `src/render/WorldRenderer.ts`).
2. **Six more slow seconds at that floor:** if the graphics preset was chosen automatically, it steps down
   once to the next simpler one and a toast says so; a preset the visitor chose in the menu or the address
   is left alone (`src/ui/game/quality.ts`, tested in `quality.test.ts`; in a browser by
   `resilience.spec.ts` › "a renderer that cannot keep up is simplified once, says so, and changes nothing in
   the world", which then runs the simplified world on for six hours and finds the hash of its whole state
   equal to that of the same seed in another browser that drew the simplest preset from the start).
3. **The automatic preset** is `medium` on touch devices, small screens and machines with fewer than six
   cores, `high` otherwise; `?q=low|medium|high` forces one.
4. **The worker cannot keep up with the speed asked:** time simply passes more slowly than the speed button
   says. Ticks are never skipped and never batched differently: the world at tick *n* is the same world
   however long it took to get there (`sim.worker.test.ts`, phase 13).
5. **A hidden tab** pauses time and writes the autosave; it resumes when seen again
   (`resilience.spec.ts`).
6. **Two tabs:** one autosave slot, one owner at a time, by the browser's Web Locks; the other tab says its
   world is not being autosaved and never overwrites the slot (`resilience.spec.ts`).
7. **A save is one IndexedDB transaction**: whole or absent, never partial. A stored save that has been
   altered is refused by its hash without touching the world on screen (`resilience.spec.ts`).

## Headless engine

`pnpm bench -- --days N --policy planner|reflex` (`scripts/bench.ts`): one thread, a warm-up day excluded, then
N simulated days. Raw output: `evidence/phase-15/bench-*.{txt,json}`.

Five days (the length of the phase-03 benchmark), engine 0.7.0 as committed:

| People | Island | Planner minds: ticks/s | tick p95 | Reflex minds: ticks/s | Heap after the run | Save as text | Save as stored | Time to pack it |
|---|---|---|---|---|---|---|---|---|
| 50 | 64 × 64 | 3,244 | 0.72 ms | 6,021 | 21 MB | 1,162 KiB | 112 KiB | 31 ms |
| 100 | 64 × 64 | 2,106 | 1.00 ms | 2,532 | 36 MB | 2,438 KiB | 245 KiB | 54 ms |
| 250 | 96 × 96 | 595 | 2.89 ms | 712 | 61 MB | 10,953 KiB | 859 KiB | 247 ms |
| 500 | 128 × 128 | 234 | 9.33 ms | 493 | 88 MB | 36,868 KiB | 2,076 KiB | 398 ms |

(The save and heap columns are from the planner run. Phase 03 measured 6,439 ticks a second for 50 reflex
agents on a simpler engine and a different machine; the two are not a before and after.)

**Twenty days tell a different story, and it is the one to believe**: a world's later days cost more than its
first (more is known, more is built, more is said), and a crowded world eventually goes hungry.

| People | Island | Before the route finder's memo | After it, three runs | tick p95 before → after | Slowest tick before → after |
|---|---|---|---|---|---|
| 50 | 64 × 64 | 1,082 ticks/s | 1,371 · 1,579 · 1,070 | 2.1 → 1.4–2.1 ms | 6.4 → 3.5–4.5 ms |
| 100 | 64 × 64 | 395 | 665 · 790 · 819 | 6.5 → 2.7–4.5 ms | 13.5 → 7.5–7.9 ms |
| 250 | 96 × 96 | **41** | 253 · 278 · 240 | **130** → 8.4–10.2 ms | 239 → 22–32 ms |
| 500 | 128 × 128 | **13** | 101 · 102 · 97 | **279** → 19.9–23.1 ms | 433 → 43–58 ms |

The three runs differ by up to a third at 50 people: the machine is a shared one, and that spread is the
honest precision of every number in this file.

### What the profile found (D-046)

`node --cpu-prof --import tsx scripts/bench.ts -- --policy planner --days 20 --only 250`, summarized by
`node scripts/cpuprofile-top.mjs`. Before: **75% of the process in `findPath`**
(`profile-planner-250-before-memo.txt`). In a crowded world that is starving, baseline planner agents ask
every tick to gather from a place they cannot reach, and every asking searched the island
(`unreachable-refusals.txt`: none in the reference world in forty days; 7,014 on the twentieth day of the
250-person world). The route finder now remembers a failed search for exactly as long as nothing it
depended on has changed; the worlds are hash for hash what they were (`pathfind-memo.txt`; 48 cells of the
confirmatory batch and 24 of the pilot re-run and reproduced). After: perception is the largest single cost
at about a quarter of the process (`profile-planner-50.txt`, `profile-planner-250.txt`), spread over loops on
typed arrays, with no one function to rewrite.

**No WebAssembly.** The phase allows it "only after benchmark proves bottleneck". The bottleneck that the
benchmark proved was an algorithmic one and is gone; what remains leaves the reference world eight times
faster than the fastest speed needs. A second implementation of the engine would have to be proven
bit-identical to the first for every recording and study ever made, and nothing measured here would repay that.

**What was not repaired:** the behaviour that caused it. Those agents still ask for the unreachable, and
some starve asking. It is a defect of the hand-written baseline, it does not happen in worlds of the
reference size, and repairing it is a change of behaviour: engine 0.8.0, in the redesign phase.

### What the engine does to stay fast, and where

- **Spatial indexes:** people per tile as linked lists rebuilt each tick; structures and piles by tile
  (`sim/scratch.ts`). Perception and hearing walk tiles in range, not people.
- **Compact arrays:** terrain, resources, what each person has seen and believes, the route finder's buffers
  and the frames sent to the page are typed arrays; a frame's two large arrays are transferred, not copied.
- **Instancing:** 50–85 draw calls for 0.4–1.7 million triangles (the browser table below).
- **Measures kept as they happen:** society measures are accumulated from events and sampled once a day
  (`metrics/accumulate.ts`), never recomputed from the ledger.
- **Bounded storage:** the worker keeps the last 40,000 events and at most 24 compressed moments of a world;
  the page keeps 600 lines of Chronicle; the server deletes rate-limit windows older than a day.

## In a browser

`node scripts/perf.mjs <url> evidence/phase-15` against the production build: the reference world and one of
twice its size, three graphics presets, a desktop window (1366 × 768) and a phone's (390 × 844 at 3×), each
watched for ten seconds and then run at the fastest speed. Raw output: `perf-browser.{json,md}`.

**The 3D view was drawn by a software rasterizer** (SwiftShader; Chromium 158.0.8127.36 (headless)). Within seconds every
row had been stepped down to the lowest resolution (0.6) by the fallback, and still:

| View | People | Preset | Frame p50 / p95 | Draw calls | Triangles | One tick in the worker p50 / p95 / longest | Save as text → as stored | Page heap |
|---|---|---|---|---|---|---|---|---|
| desktop | 50 | low | 450 / 583 ms | 50 | 0.41 M | 0.7 / 2.1 / 9.8 ms | 1,667 → 281 KB | 42.6 MB |
| desktop | 50 | medium | 1183 / 1917 ms | 72 | 1.62 M | 0.6 / 1.7 / 8.8 ms | 1,660 → 325 KB | 40.1 MB |
| desktop | 50 | high | 1350 / 1900 ms | 85 | 1.65 M | 0.5 / 2.4 / 14.5 ms | 1,611 → 319 KB | 48.1 MB |
| desktop | 100 | low | 417 / 600 ms | 51 | 0.48 M | 1.4 / 4.6 / 16.3 ms | 3,484 → 616 KB | 31.6 MB |
| desktop | 100 | medium | 1250 / 1617 ms | 72 | 1.71 M | 0.4 / 2.7 / 12.4 ms | 3,540 → 715 KB | 37.8 MB |
| desktop | 100 | high | 1367 / 2383 ms | 85 | 1.74 M | 0.4 / 2.4 / 13.8 ms | 3,541 → 715 KB | 87.5 MB |
| phone | 50 | low | 367 / 450 ms | 50 | 0.41 M | 0.6 / 1.7 / 9.2 ms | 1,618 → 262 KB | 42.6 MB |
| phone | 50 | medium | 1133 / 1433 ms | 72 | 1.62 M | 0.6 / 1.6 / 14.7 ms | 1,680 → 323 KB | 26.3 MB |
| phone | 50 | high | 1217 / 2100 ms | 85 | 1.65 M | 0.6 / 2.1 / 12 ms | 1,660 → 324 KB | 48.1 MB |
| phone | 100 | low | 417 / 533 ms | 51 | 0.48 M | 1 / 3.1 / 13.5 ms | 3,209 → 509 KB | 29.8 MB |
| phone | 100 | medium | 983 / 1417 ms | 71 | 1.71 M | 1.8 / 5.2 / 19.1 ms | 3,589 → 722 KB | 42.6 MB |
| phone | 100 | high | 1417 / 2266 ms | 85 | 1.73 M | 1.7 / 5.2 / 19.5 ms | 3,577 → 723 KB | 61 MB |

Read it for these and nothing else:

- **Frame time here is a software renderer's**: 0.4 s a frame at the simplest preset and over a second at the
  others. It is not an estimate of anything a visitor would see, and it is the reason the page's own
  latencies below are what they are.
- **The scene is 50–85 draw calls** for 0.4 million triangles at the simplest preset and 1.6–1.7 million at
  the others, and does not grow with the population in draw calls.
- **A tick takes the worker 0.5–0.7 ms at 50 people and 0.4–1.8 ms at 100** at the median, 1.6–5.2 ms at
  the 95th percentile, beside a renderer that is using every core.
- **A world of 50 people is 1.6–1.7 MB as text and 0.26–0.33 MB as stored**; of 100, 3.2–3.6 MB and 0.5–0.7 MB.
  (These worlds are fifteen to fifty days old. A save grows with what its people have come to know: the
  benchmark's five-day world is 1.2 MB and 0.11 MB.)
- **The page's heap is 26–88 MB.** The worker's is not reported by the browser.

How fast time actually passed at the fastest speed cannot be read from that run: the tick was read from the
page over five seconds while a frame took up to 1.4 seconds, which is good to about a quarter either way
(the raw column ranges from 70 to 130 of the 128 asked). It was measured again over twenty seconds with the
view drawn 48 px wide and the simplest preset (`perf-browser-small-world.{json,md}`; frames still took 0.3 s
there, so the processor was still shared):

| View | People | Ticks a second achieved (128 asked) | One tick p50 / p95 / longest | Worker's answer, idle | Save as stored |
|---|---|---|---|---|---|
| desktop | 50 | 128 | 0.6 / 2 / 15.1 ms | 352.9 ms | 322 KB in 439 ms |
| desktop | 100 | 110 | 1.6 / 4.9 / 22.7 ms | 1 ms | 722 KB in 384 ms |
| phone | 50 | 121 | 0.4 / 1.5 / 14.7 ms | 0.6 ms | 321 KB in 332 ms |
| phone | 100 | 117 | 1.7 / 5.1 / 21.4 ms | 3.3 ms | 723 KB in 506 ms |

and without a browser at all — the worker's own loop and real timers in Node, nothing else running
(`pnpm exec tsx scripts/worker-pace.ts`, `worker-pace.{txt,json}`):

| People | 16× (32 asked) | 64× (128 asked) | 64× before the fix below |
|---|---|---|---|
| 50 | 32.0 | 127.8 | 126.3 |
| 100 | 32.0 | 128.0 | 116.1 |
| 250 (96 × 96) | 30.1 | 79.3 | 78.3 |

**A fix that came out of this.** The worker used to forget everything it owed as soon as eight ticks were
owed — a sixteenth of a second at the fastest speed — so a few slow ticks cost a 100-person world a tenth of
its pace. It now keeps up to half a second of what is owed and makes it up on the following frames; a device
that cannot keep the pace is still never chased. The world at a given tick is the same either way
(`sim.worker.test.ts`). At 250 people the fastest speed is out of reach of the worker's 14 ms of work per
frame, by design: time passes at about 80 ticks a second there, and at 16× it holds.

**What the page's own latencies were, and why they prove little.** A question to the worker came back in
2–6 ms when the page was not in the middle of drawing. While the world ran at the fastest speed, the same
question took 0.4–3.2 s to come back *to the page*, and a save 0.4–1.7 s, because the page's one thread was
inside a frame that long when the answer arrived. The worker itself never works for more than 14 ms before returning to its
queue. On a device that draws a frame in 16 ms these would be bounded by that; nothing here shows it.

## The budget ledger under load

`pnpm load` (`scripts/load.ts`): 20,000 reservations attempted by 32 workers through two connection pools on
PostgreSQL 16, with settlements, releases, timeouts, duplicates and retries mixed in, under a total, a daily
and a per-run ceiling small enough to be hit. No provider is involved. Raw output: `load.{txt,json}`.

| Measure | Result |
|---|---|
| Reservations a second | 1,144 |
| One reservation | p50 22 ms · p95 38 ms · p99 110 ms · longest 615 ms |
| One settlement | p50 30 ms · p95 173 ms · p99 264 ms · longest 454 ms |
| A ceiling exceeded at any sampled moment | never |
| Errors, deadlocks, lost transactions | none |
| Duplicates refused / settlements arriving twice and applied once | 89 / 132 |
| The books at the end | balanced: $24.04 settled, $5.96 held as unknown, $10.00 of $40.00 left |

These are from the database code as it now is (D-047: each transaction carries its own limits). The run made
before that change is kept beside it (`load-startup-limits.{txt,json}`: 1,059 a second, p50 25 ms): the same
within the noise of this machine. **Through a transaction pooler** — where a hosted database is usually
reached — the same test balances the same books at 809 reservations a second, one reservation p50 33 ms,
p95 58 ms (`evidence/phase-16/pooler.txt`).

What else the phase asked to be loaded, and where it is: locks and lease expiry between two server instances
stepping one run (`runs.test.ts`, on PostgreSQL); retries and the circuit breaker (`runs.test.ts`); rate
limits (`auth.test.ts`, `api.test.ts`); a function killed mid-call (`runs.test.ts`, the interrupted-call
tests); statements, locks and idle transactions past their limits, and connections dropped under a
transaction (`db.test.ts`). All of them use mock or canned providers. **No live orchestration has been
loaded, because no live call has been made.**

## The server's own routes

`pnpm requests` (`scripts/requests.ts`): the production server on loopback with a throwaway owner and a
ledger schema of its own, one request at a time unless it says otherwise. Raw output: `requests.{txt,json}`
(and `requests-startup-limits.{txt,json}`, from before D-047).

| Request | p50 | p95 | longest |
|---|---|---|---|
| `GET /api/health` | 2.1 ms | 4.1 ms | 7.7 ms |
| `GET /` (the game's page, 11 KB) | 2.4 ms | 4.0 ms | 14.4 ms |
| `GET /lab` | 2.2 ms | 2.9 ms | 7.3 ms |
| `GET /api/owner/status`, signed out (touches no database) | 2.1 ms | 4.2 ms | 38.2 ms |
| `GET /api/recordings` | 1.9 ms | 3.7 ms | 4.6 ms |
| `GET /api/runs/:id`, a visitor reading a published run (7 KB) | 2.5 ms | 4.6 ms | 5.7 ms |
| `GET /api/owner/status`, signed in (budget, runs, audit) | 4.3 ms | 8.4 ms | 20.0 ms |
| `GET /api/health`, twenty at a time | 15.8 ms | 54.1 ms | 68.9 ms |
| `POST /api/runs/:id/step`: one six-hour epoch, 50 people, 8 mock decisions | 132 ms | 154 ms | 154 ms |

Once each: sign-in 293 ms (the passphrase is hashed with scrypt at N = 2^17 on purpose); a preview for 50
people 58 ms; creating and storing a run 91 ms; the first request that needs the database, which makes and
migrates its schema, 77 ms; the server ready 0.6 s after it is started.

With the database behind a transaction pooler on the same machine, the routes that read it take a few
milliseconds longer — the list of recordings p50 3.2 ms, a published run 5.1 ms, the signed-in status 8.2 ms —
and the rest are unchanged (`evidence/phase-16/pooler.txt`). None of this is a deployment: a hosted database
is a network away, and that has not been measured.

**API cost: none to report.** No request has been sent to the provider. What a call would hold, and why
that is a bound and not an estimate, is `docs/COST.md`.

## Resilience

Each of these is a test that runs in a real browser against the production build (`tests/e2e/resilience.spec.ts`
unless another file is named), on the desktop project.

| Condition | What happens | Shown by |
|---|---|---|
| Background tab, phone suspended | Time stops when the tab is hidden; the autosave is written at once; time starts again when the tab is seen | "two tabs share one autosave slot…" (the hidden-tab part) |
| Two tabs | One owns the autosave slot; the other says its world is not being autosaved and never overwrites it; it takes the slot up when the first closes | the same test |
| Refresh | The latest autosave is offered on the title screen and opens to the same world; its past is lived again from its seed and kept only if it arrives exactly | `play.spec.ts` (save, reload, continue), `history.spec.ts` |
| A save cut short or altered | A save is one transaction; an altered one fails its hash and is refused without touching the world on screen | the same test as two tabs; `save/validate.test.ts` |
| Any speed, any frame rate, long pauses | The world at a given tick is the same world | `sim.worker.test.ts` › "single steps, long steps, play at any speed, any frame rate and any pauses arrive at the same world at the same tick" |
| A renderer that cannot keep up | Resolution steps down; then, once, the preset (if automatic); six hours on, the world's hash is that of a world drawn with the simplest preset from the start | "a renderer that cannot keep up is simplified once, says so, and changes nothing in the world" |
| A slow network | Once the page has loaded, free play asks its own server for nothing and no other server for anything (`play.spec.ts` asserts that no request goes to another origin; only the list of recordings and the Laboratory fetch data, when opened). The owner console's steps are leased: a step that is cut off is resumed, and nobody is asked twice (`runs.test.ts`) | as named. **Not tested:** loading the page itself over a slow or failing connection; there is no offline cache |

## What is not known

- **Frame rate on any real device.** Not measured, not claimed. The fallbacks above are what the application
  does about it; whether they suffice on a given phone has to be seen on that phone.
- **Memory inside the worker in a browser.** Chromium does not report a worker's heap to the page; the
  headless figure for the same engine is 21 MB at 50 people and 88 MB at 500.
- **Other browsers.** Only Chromium has run it.
- **Anything about live calls:** latency, throughput, cost.

