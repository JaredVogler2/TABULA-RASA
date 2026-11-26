# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m`, restarted from `main` after each merge. Pull requests 1 (phases
  01–05, 09, 10), 2 (phases 06–08, 11–14), 3 (phases 15–20) and 4 (the evidence for the whole-suite run, and
  D-050) were merged to `main` by the owner on 2026-11-25. Pull request 5 holds one rewritten browser test
  and the evidence that came after D-050.
- **Phases:** 01–07, 09, 10, 14, 16 PASS · 08 PARTIAL (one item needs a model) · 11, 12 PARTIAL (no GPU, no
  device, no human playtest) · 13 PARTIAL (no live recording exists to compare with) · 15 PARTIAL (every
  simulation, storage and server measurement is in; frame rates on a device with a graphics chip are not
  measurable here) · 17 BLOCKED (no spend authorized) · 18 PASS for the game alone (**deployed at
  https://tabula-rasa-bay.vercel.app** by the owner's import on 2026-11-26; 25 of 25 release checks; the console and
  live minds are not deployed) · 19 PASS (a self-assessment) · 20 PASS. **All twenty phases have been
  worked; what is left is the owner's: `docs/HANDOFF.md`.**
- **The engine is frozen at 0.7.0** (snapshot schema 6, affordances 2026.11-i, prompt p2). The confirmatory
  batch was run on it, once (D-044). Do not change engine behaviour without a new version, and never claim a
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
- `src/audio/soundscape.ts` — procedural sound; reads state, changes nothing; silent until asked for.
- `src/ui/game/**` — React HUD and panels; `controller.ts` is the single place that talks to worker + renderer.
  `fit.ts` (the top bar measures itself, D-045), `quality.ts` (which preset, and the fallback), `swipe.ts`.
  `Atlas.tsx` (map and almanac), `Journal.tsx` + `journal.ts` (field journal), `Inspector.tsx`,
  `History.tsx` (moments, world lines, files), `Compare.tsx`.
  `src/ui/owner/Console.tsx` — the owner console at `/owner`.
- `src/store/game.ts` — zustand view state; `src/persist/saves.ts` — IndexedDB saves.
- `src/app/studio` + `scripts/shots.mjs` — capture harness for art QA (D-013).

## Next actions

1. **The release is made, at level 1.** https://tabula-rasa-bay.vercel.app, a Vercel project the owner created
   by importing the repository (the assistant's connector may read the owner's projects and may not create one
   or list a project's variables). A merge to `main` deploys itself; a push to another branch makes a preview
   behind a Vercel login. After a merge that changes the product: `pnpm release:check -- https://tabula-rasa-bay.vercel.app`.
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
   minutes; try a screen reader; try Firefox and Safari. `docs/QA_REPORT.md` § Not run is the list.
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
