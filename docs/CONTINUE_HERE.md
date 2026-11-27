# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## The Long Road (2026-11-27): read this first

**Engine 0.8.0, snapshot format 7, affordances 2026.11-j, prompt p3** (D-055 to D-058). What the owner asked
for after playing, and what was done: `docs/HANDOFF.md` § Since this was written. In short: a world can be made
with crafts and newcomers; the default scenario, The Long Road, has ages, a legacy, one change a season and an
aim (four in five of the first fifty at the Age of Letters by the end of the fifth year); the aim's numbers
were set with scripted players.

- **Do not break the old worlds.** With `crafts` and `arrivals` off a world must be stepped exactly as 0.7.0
  stepped it. `tests/support/legacy-0.7.0.json` was written by the unchanged 0.7.0 engine and must never be
  regenerated; `pnpm exec tsx scripts/legacy-digests.ts --check` re-runs all thirteen worlds (the unit suite
  runs eleven), and `scripts/legacy-studies.ts --bundle pilot|confirmatory` re-runs published study cells.
  `DIGEST_COMPATIBLE_ENGINES` in `src/engine/version.ts` is the claim; those two scripts are its proof.
- **Development seeds are 1–999; 9000–9999 are holdout and 9000–9031 are spent.** Everything about crafts,
  arrivals and the aim was set on seeds 1–14. `scripts/climb.ts` and `scripts/hands.ts` refuse other seeds.
- **How hard is it?** `pnpm exec tsx scripts/hands.ts --seeds 1-12 --years 5 --stop-at-aim` plays the same
  islands with scripted hands and reports the game's own aim; `scripts/hands-aims.ts <files.json>` scores
  other aims of the same kind from recorded runs. A thriving island (a hundred and more people) is slow to
  step: a batch of twelve islands and seven players took about half an hour on three cores.
- **People arrive in the middle of a step.** Anything sized by headcount must be sized by
  `agentCapacity(config)`, not by how many are there (D-055: a table one place short stopped a world for good).
- **What nobody has done:** played it. The players in every number are scripts.
- **Ideas put to the owner and not built** (D-058): harder grades of the aim, choosing where a change falls,
  hardships with signs and changes saved for them, a wonder that draws the curious, an island a day.
- **A browser test must not depend on where the world happens to stop.** The world runs in its worker at
  its own pace while a click waits for the page, so the tick at which a test reaches a step differs from run
  to run, and by more on a software renderer. Two tests failed in CI on this pull request for that reason and
  no other (`evidence/long-road/observer-race.txt`, `someone-else.txt`): step to a known tick, or make the
  step work at any. CI keeps nothing of a failed browser run but its log, so a test's message should say the
  tick.
- **The owner merges quickly and a merge deploys itself** (below). The Long Road is the default scenario on
  the title screen: a fault in it is the first thing a visitor meets.

Checked on this work's tree: `pnpm test` 568 passed, 2 skipped by design, 48 files (with PostgreSQL); lint,
types and every generated-file check; the legacy scripts above; `tests/e2e/goal.spec.ts` on both projects
(2 passed). The whole browser suite was not finished here: a run on the tree before the graphics merge was
stopped by the session's 30-minute limit on background commands after 13 of 38 tests, all passing
(`evidence/long-road/e2e-local-partial.txt`). CI runs both projects on every push, and GitHub has the result
for the head. **A background command here is stopped after 30 minutes unless given a longer limit: the whole
suite needs about 45.**

## Graphics, second pass (2026-11-27)

D-054: a frame made cheaper, and the saving spent on leaves, water, rock and the sky's light
(`src/render/detail.ts`, `flora.ts`, `terrain.ts`, `water.ts`; tests in `src/render/realism.test.ts`).
`node scripts/frame-cost.mjs` sets one build beside another by processor time, which holds on a busy machine
where the wall clock does not. `stats().drawCalls` and `.triangles` are now the dearer of the last two frames
(shadows are redrawn every second frame); `drawCallsMean` and `trianglesMean` are new. Left for a next pass,
by the one who made it: a still toward the sun to judge the glints and the light through a crown's rim; the
leaf texture reads woolly close in; thin rock beds read as ruled lines; shadow grain on smooth crowns.

## Graphics update (2026-11-27)

D-053 builds on `6ec20bc` (pull request 9). The renderer and desktop framing are in `a4fce54`. The citizen geometry lives in `src/render/citizenGeometry.ts`.
Pose, visibility and equipment still follow the worker frame in `src/render/citizens.ts`. Use
`pnpm exec vitest run src/render/citizens.test.ts` to check the batched limbs and props, and the
[studio queries in Evidence](EVIDENCE.md#citizen-and-island-realism-d-053-2026-11-27) to reproduce the captures.
Review the branch preview before merging to the Vercel production branch. Physical-device frame rates are open.

## Current state (2026-11-26)

- **Branch:** `claude/friendly-gauss-kejb2m`, brought up to `main` after each merge. Pull requests 1 (phases
  01–05, 09, 10), 2 (phases 06–08, 11–14), 3 (phases 15–20) and 4 (the evidence for the whole-suite run, and
  D-050) were merged to `main` by the owner on 2026-11-25, and on 2026-11-26: 5 (the record of the
  deployment, D-051, the phone notice, the charters test), 6 (a notice enters where it stays), 7 (the fixes
  for what the owner's phone showed that day: a crowded list, and a Follow that did not appear to follow,
  D-052) and 8 (the record of 7, and three small changes made after it). Whether anything later is open or
  merged is on GitHub, not here: `CHANGELOG.md` has an entry for each pull request, written with it. **A
  merge to `main` deploys itself to production**; a push to this branch makes a preview on Vercel behind a
  login. **The owner merges within minutes of a green check, sometimes before a second commit is pushed:**
  after pushing, look at the pull request's state before pushing again, and open a new one for what was left
  out.
- **Phases:** 01–07, 09, 10, 14, 16 PASS · 08 PARTIAL (one item needs a model) · 11, 12 PARTIAL (no GPU, no
  device, no human playtest) · 13 PARTIAL (no live recording exists to compare with) · 15 PARTIAL (every
  simulation, storage and server measurement is in; frame rates on a device with a graphics chip are not
  measurable here) · 17 BLOCKED (no spend authorized) · 18 PASS for the game alone (**deployed at
  https://tabula-rasa-bay.vercel.app** by the owner's import on 2026-11-26; 25 of 25 release checks; the console and
  live minds are not deployed) · 19 PASS (a self-assessment) · 20 PASS. **All twenty phases have been
  worked; what is left is the owner's: `docs/HANDOFF.md`.**
- **The engine was frozen at 0.7.0** (snapshot schema 6, affordances 2026.11-i, prompt p2) when this section
  was written, and the confirmatory batch was run on it, once (D-044). It is 0.8.0 now (top of this file),
  and steps such worlds identically. Do not change engine behaviour without a new version, and never claim a
  new confirmatory result from seeds 9000–9031: they are spent.
- **Last commit verified as a whole:** `de2f0e1` (phase 20), in a clean checkout: `pnpm check` and the whole of
  `pnpm e2e`. After it: that run's logs and stills; then D-050 (a page slower than its world), for which
  `pnpm check` and the browser tests of the area it touches were run here and the whole suite by CI
  (`evidence/after-20/`).
- **Spend:** $0. No API key has ever been present. The application's authorized budget is zero, its ceiling
  is zero and its kill switch is on. **Nothing has been sent to the provider**: the request shape, the
  schema's acceptance and every cost figure are unverified against the real API. The smoke script's paid path
  (`pnpm live:smoke -- --run`) has never been run.
- **The developer agent never types the owner's authorizing words** — not "I authorize this spending", not
  the smoke test's numbered sentence, not "I approve this run and its cap". Run `pnpm live:smoke` without
  `--run` (it only reports) and nothing more.

## Verify the tree

```bash
pnpm install --frozen-lockfile
# the ledger's concurrency tests and the owner console's E2E need a PostgreSQL server:
#   service postgresql start   (role tabula / password tabula / database tabula_test, as in CI)
export TEST_DATABASE_URL=postgres://tabula:tabula@localhost:5432/tabula_test
pnpm check        # lint, typecheck, unit, generated-file freshness (affordances, migrations, prompts, licences),
                  # secret scans (files and history), build, bundle scan
pnpm e2e          # Playwright, production build, desktop + phone emulation (about 40 minutes on a CPU renderer; --project=desktop for one)
                  # one Playwright run at a time on a machine: each run's set-up drops and recreates the `e2e` schema,
                  # so a second run started beside it fails the first one's owner-console tests with "The server answered 500"
pnpm sim -- --scenario first_light --seed 1 --days 40 --policy planner --replay
pnpm exec tsx scripts/climb.ts --scenario long_road --seeds 1-4 --years 10   # how far untouched islands climb, year by year
pnpm exec tsx scripts/hands.ts --seeds 1-4 --years 5 --stop-at-aim           # the same islands under scripted players
pnpm exec tsx scripts/legacy-digests.ts --check                              # every world recorded under 0.7.0, re-run
pnpm compare -- --seeds 1-4 --days 40                  # paired baselines, development seeds
pnpm schedulers -- --seeds 1-4 --days 6 --slots 8      # activation policies on the same worlds, mock minds, no cost
pnpm record -- --id mock-first-light --seed 7 --days 6 # re-record the bundled mock recording (verifies it replays)
pnpm exec tsx scripts/mixed.ts --seeds 1-4 --days 40   # planners and reflex agents on one island
pnpm exec tsx scripts/civics.ts --scenario long_winter --seeds 1-4 --days 30   # what institutions did, per mode
pnpm exec tsx scripts/shores.ts --seeds 1-12 --days 80 # Two Shores, per shore
# the laboratory (costs nothing; development seeds only unless --confirmatory --plan <file>)
pnpm study -- --study all --seeds 1-16 --out /tmp/pilot                 # every registered condition; resumable, --shard i/N
pnpm study -- --analyse --study all --seeds 1-16 --out evidence/phase-16/pilot   # report from finished runs only
pnpm study -- --verify 16 --study all --seeds 9000-9031 --confirmatory --plan evidence/phase-16/pilot/plan.json --out evidence/phase-16/confirmatory   # re-run cells of the batch, compare hashes (runs nothing new)
# performance (docs/PERFORMANCE.md says what each number means and does not mean)
pnpm bench -- --days 5 --policy planner                # headless engine at 50/100/250/500 people
pnpm load                                              # the budget ledger under contention (needs TEST_DATABASE_URL)
pnpm requests                                          # the server's own routes, timed (needs a build and TEST_DATABASE_URL)
node scripts/perf.mjs http://127.0.0.1:3210 /tmp/perf  # in a browser (needs `pnpm build && pnpm exec next start -p 3210`)
node scripts/topbar.mjs http://127.0.0.1:3210 /tmp/topbar   # the top bar at 25 widths, three ways
node scripts/trail.mjs http://127.0.0.1:3210 /tmp/trail     # how far the picture trails the world when the page is slowed (D-050)
node scripts/sight.mjs http://127.0.0.1:3210 /tmp/sight     # can it be seen: lists of rows at six sizes; a citizen tapped, followed, zoomed on and walking (D-052)
node scripts/shots.mjs /tmp/shots vista closeup forager woodcutter charter knowledge dusk night phone low   # art stills
# what is configured for live calls, and what is missing (makes no request, changes nothing)
pnpm live:smoke
# is a running site what a release should be? (a deployment's address, or a local `next start`; signs in nowhere)
pnpm release:check -- http://127.0.0.1:3299 --fast
pnpm release:check -- https://tabula-rasa-bay.vercel.app --fast     # the deployment (--fast where there is no graphics chip)
```

Expected at `de2f0e1`: `pnpm check` exits 0 with 491 unit tests in 40 files (ten need PostgreSQL and are skipped
without `TEST_DATABASE_URL`). `pnpm e2e`, in a clean checkout on this machine's software renderer: 28 passed, 5
skipped by design and one timed out, in 39.7 minutes — the renderer-fallback test ran out of a 300-second limit
with nothing it asserts having failed. Its limit is ten minutes since the commit after, and it passes on its own
in 4.5. The same commit's whole suite passed on GitHub's runners, both projects
(`evidence/phase-20/tests.txt`, `e2e-run.txt`, `e2e-fallback-rerun.txt`, `ci.txt`). `replay IDENTICAL`.

With D-050 on top (`b25d1b7`): `pnpm check` exits 0 with 495 unit tests in 40 files (four more, for the pacing
of frames); `pnpm e2e`: 29 passed, 5 skipped by design, none failed, in 42 minutes; the same commit is green on
GitHub's runners (`evidence/after-20/e2e-run.txt`, `ci.txt`). The commit after it rewrites one browser test
(the charters test steps its world to a known moment): `pnpm exec playwright test tests/e2e/play.spec.ts
--project=desktop`, 3 passed (`evidence/after-20/e2e-play.txt`).

After those: `pnpm test` is 496 tests (D-051 adds one).

With D-052 (what the owner's phone showed): `pnpm check` exits 0 with 518 unit tests in 43 files — 22 more, for
the camera rig, what counts as the same selection, a pull upwards on a card, and the arithmetic of what the
interface covers. `pnpm exec playwright test tests/e2e/play.spec.ts`: 4 passed on the desktop project, 2 passed
and 2 skipped by design on the phone project. The whole suite was green on GitHub's runners on `7d8a306`,
which is what was merged as pull request 7; here a whole-suite run was stopped by hand after 12 of 36, all
passing (`evidence/after-20/follow.txt`). After that merge both fixes were measured on the deployed site
(`evidence/after-20/sight-live.md`) and the release check run again: 25 of 25. The whole suite was green
again on `1a00bf3`, which is what was merged as pull request 8; the site was checked after that merge too —
25 of 25, and the two of its changes that can be seen were looked for and found
(`evidence/after-20/after-pr8.txt`). The whole-loop test has since gained two assertions: that a tapped card
eases open (phone project), and that the Follow button agrees with the camera after a jump from the Chronicle
(desktop project). Each was run against a build with its old line, where it fails, and against the tree,
where it passes; the whole suite runs in CI on every push, and GitHub has its result. **The development container loses its services when it
sleeps:** if the database tests fail with `ECONNREFUSED 127.0.0.1:5432`, run `service postgresql start` (the
role and the database are still there). **Some unit tests draw their cases at random, and
differently every run** (`fast-check`). One of them can fail on a commit that has nothing to do with it; when
that happens the log prints a seed and a path. Replay them (`fc.check(property, { seed, path })`), find what
the value shows, and fix that: the one such failure so far was a real edge (D-051). Do not run the job again
and hope.

## Execution order (D-001)

01 ✔ → 02 ✔ → 03 ✔ → 04 ✔ → 05 ✔ → 09 ✔ → 10 ✔ → 06 ✔ → 07 ✔ → 08 (partial) → 11 (partial) → 12 (partial) →
13 (partial) → 14 ✔ → 15 (partial) → 16 ✔ → 17 (blocked) → 18 (blocked: prepared) → 19 ✔ → 20 ✔

## Where things live

- `src/engine/**` — pure deterministic simulation (no DOM, no time, no `Math.random`; lint-enforced).
- `src/providers/**` — minds outside the engine, with no secrets: `wire.ts` (answer schema and translation),
  `prompt.ts` (prompt p2), `mock.ts` / `replay.ts` (free providers), `schedule.ts`, `run.ts` (epoch runner),
  `prices.ts` (dated price table, microdollar arithmetic).
- `src/server/**` — server only: `ledger.ts`, `auth.ts` + `http.ts` (the gate), `anthropic.ts` (live adapter
  and the guard around its `fetch`), `runs.ts` (lease, stored answers, recovery of interrupted calls, commit),
  `smoke.ts` (the live smoke test; `scripts/live-smoke.ts` is its only way in), `env.ts` (what live mode
  needs, the ceiling), `api.ts` (the owner API as functions; routes in `src/app/api` only forward), `db.ts`
  (PostgreSQL or PGlite; every transaction opens with its own limits, so it works through a pooler: D-047).
  `db/migrations/*.sql` is the schema's source; run `pnpm gen:migrations` after changing it.
- `src/worker/sim.worker.ts` — owns the world, its twin and its history (moments, lines set aside, re-runs,
  rebuilding a loaded world's past, files, the event ledger); posts view frames of either world, one at a
  time: the next is sent when the page has answered the last with `taken` (D-050; **anything that receives
  frames must answer each one**, as `src/store/simClient.ts` does); plays recordings and checks them against
  the record; `protocol.ts` is the only contract with the page.
  `sim.worker.test.ts` drives it through that protocol with no browser. `aims.ts` reads how the scenario's
  stated aim stands from the world's state (D-049): **a new scenario needs a case there, and
  `scripts/aims.ts` run on development seeds before its aim is written on a card.**
- `src/engine/save/history.ts` — manifests, bundles (export/import with integrity checks), replay from a state.
  `src/engine/save/validate.ts` — every field of a restored world, checked (D-043): **a field added to the
  engine's state must be added there too**.
- `src/lab/**` — `studies.ts` (the registered hypotheses as data, `runCell`), `stats.ts`, `analyse.ts`
  (reports, verdict rules, sizing), `cost.ts` (ceilings for live designs); `scripts/study.ts` is the batch
  runner; `/lab` (`src/ui/lab/Lab.tsx`) reads `public/studies/**`.
- `src/render/**` — imperative three.js (`WorldRenderer`); never imported by the engine, never imports React.
  `citizens.ts` (figures, props, the faint shape of hidden people), `ambient.ts` (smoke, fish rises, birds),
  `overlays.ts` (what a citizen knows; ties), `structures.ts` (buildings, agreements' posts and pennants).
  `cameraRig.ts` (pan, zoom, turn, follow; what ends a follow and what does not; the picture cut off-centre
  so that what it looks at is drawn in the map the interface leaves uncovered — D-052), `timing.ts` (the step
  animation takes, and the one the camera takes), `pick.ts` (when two selections are the same). **Each frame
  people take their places before the camera moves**: turn that round and a followed walker is trailed.
- `src/audio/soundscape.ts` — procedural sound; reads state, changes nothing; silent until asked for.
- `src/ui/game/**` — React HUD and panels; `controller.ts` is the single place that talks to worker + renderer.
  `fit.ts` (the top bar measures itself, D-045), `quality.ts` (which preset, and the fallback), `swipe.ts`,
  `cover.ts` (keeps the camera told what the interface covers on a narrow screen: every child of the element
  marked `data-hud` counts, so **a new bar or sheet over the map belongs inside it**).
  `Atlas.tsx` (map and almanac), `Journal.tsx` + `journal.ts` (field journal), `Inspector.tsx`,
  `History.tsx` (moments, world lines, files), `Compare.tsx`.
  `src/ui/owner/Console.tsx` — the owner console at `/owner`.
- `src/store/game.ts` — zustand view state; `src/persist/saves.ts` — IndexedDB saves.
- `src/app/studio` + `scripts/shots.mjs` — capture harness for art QA (D-013).

## Next actions

1. **The release is made, at level 1.** https://tabula-rasa-bay.vercel.app, a Vercel project the owner created
   by importing the repository (the assistant's connector may read the owner's projects and may not create one
   or list a project's variables). A merge to `main` deploys itself; a push to another branch makes a preview
   behind a Vercel login. After a merge that changes the product: `pnpm release:check -- https://tabula-rasa-bay.vercel.app`,
   and for anything a phone shows, `node scripts/sight.mjs https://tabula-rasa-bay.vercel.app /tmp/sight`.
   **Not deployed:** the console (level 2) — it needs a database, a billable integration that has not been
   asked for and needs the owner's approval — and live minds (level 3, phase 17). Open on the deployment: which
   Node.js runs it was not observed (`docs/DEPLOYMENT.md` § Known unknowns).
2. **After the phases.** Recorded in `docs/HANDOFF.md` and not done, because each changes the engine's
   behaviour (a new version, and for anything experimental a new registration on seeds 9032 and up): a
   positive control that holds (D-044); planners that stop asking for the unreachable in a crowded famine
   (D-046). Smaller, and safe on the frozen engine: a per-shore reading in Compare; a resources overlay; a
   view of everyone's ties at once; a separate host for the owner's console (D-042).
3. **Phase 17 is blocked on the owner.** What is needed, in order, is in `docs/COST.md` § First live call. The
   first authorized act is the smoke test, and the words that authorize it are the owner's to type.
4. **What could not be done here** (needs the owner or a device): look at it on a real GPU and a real phone
   and record frame rates; listen to the sound; have someone who did not build it play the first fifteen
   minutes; try a screen reader; try Firefox and Safari. `docs/QA_REPORT.md` § Not run is the list. The owner's
   first few minutes on a phone found two defects that everything here had passed (D-052): **a control that
   reports its own state is not tested until what it controls has been looked at**. The fixes for those two
   have been measured in Chromium at a phone's size, and not yet seen on a phone.
5. Engine notes:
   - Model: `docs/ODD.md`; institutions: `docs/INSTITUTIONS.md`; baselines: `docs/COGNITION.md`; ecology: D-014;
     society measures: `src/engine/metrics/society.ts`. Never tune on holdout seeds (9000–9999).
   - The positive control failed on holdout seeds (D-044). A redesign of the control or of H4's shock is a
     new registration on seeds 9032 and up, not a second look at the same ones.
   - Snapshots at 500 agents are about 36 MiB as text and 2 MiB as stored (packed). Server-side runs are
     limited to 120 people.

## Open questions for the owner (none of them blocks offline work)

- **Whether to go on to the console** (level 2), which needs a database: not asked yet. The game alone is
  deployed.
- **Which model?** `ANTHROPIC_MODEL` has no default. Per-call upper bounds are in `docs/COST.md`.
- **A ceiling for the deployment** (`BUDGET_CEILING_USD`), **an amount for a smoke test** (at most $2), then
  separately for a pilot.
- **A licence for this repository.** `package.json` says `UNLICENSED`; `docs/THIRD_PARTY.md` lists what it
  depends on.
- **A separate host for the owner console** (`docs/SECURITY.md`, "One origin").
- A stray file, `/nodes-old.ts`, was left at the root of the build container's filesystem by a mistyped
  command in the phase-16 session (outside the repository; it is a copy of an old engine file). Removing it was
  blocked by the session's safety check. It is harmless and does not exist in any clone.

## Blockers

None for offline work. Live API work (phase 17) and the last item of phase 08 are blocked on explicit owner
authorization of a dollar ceiling. Deployment (phase 18) is blocked on the owner's approval.

## Conventions worth remembering

- Never use `Math.random`, `Date`, timers or transcendental `Math` functions under `src/engine` (lint error).
- Development seeds are 1–999; holdout seeds 9000–9999 are reserved for confirmatory studies.
- Bump `ENGINE_VERSION` when behaviour changes, `SCHEMA_VERSION` (with a migration) when saved shapes change,
  `AFFORDANCE_VERSION` (and the registry) when what agents can perceive or do changes.
- `docs/AFFORDANCES.md`, `docs/PROMPTS.md`, `docs/THIRD_PARTY.md` (with `public/licenses.txt`) and
  `src/server/migrations.generated.ts` are generated: `pnpm gen:affordances`, `gen:prompts`, `gen:licenses`,
  `gen:migrations`. CI fails if one is stale.
- Nothing under `src/` may turn a string into markup or code (lint: `no-injection-sinks`).
- A secret scan excuses no line: fixtures use short, obviously fake values, and tests assemble their examples
  at run time.
- Next.js conventions: read `node_modules/next/dist/docs/` — this is Next 16 (Turbopack, `proxy.ts`, async
  request APIs, Cache Components).
