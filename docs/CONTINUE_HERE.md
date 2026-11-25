# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m` · PR: https://github.com/JaredVogler2/TABULA-RASA/pull/2
  (pull request 1, phases 01–05, 09 and 10, was merged to `main` by the owner on 2026-11-25).
- **Phases:** 01–07, 09, 10, 14, 16 PASS · 08 PARTIAL (one item needs a model) · 11, 12 PARTIAL (no GPU, no
  device, no human playtest) · 13 PARTIAL (no live recording exists to compare with) · 15 PARTIAL (every
  simulation, storage and server measurement is in; frame rates on a device with a graphics chip are not
  measurable here) · 17 BLOCKED (no spend authorized) · **next: 18** (release: prepare, then ask the owner
  before deploying anything), 19, 20.
- **The engine is frozen at 0.7.0** (snapshot schema 6, affordances 2026.11-i, prompt p2). The confirmatory
  batch was run on it, once (D-044). Do not change engine behaviour without a new version, and never claim a
  new confirmatory result from seeds 9000–9031: they are spent.
- **Last verified commit:** see `git log -1`.
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
node scripts/shots.mjs /tmp/shots vista closeup forager woodcutter charter knowledge dusk night phone low   # art stills
# what is configured for live calls, and what is missing (makes no request, changes nothing)
pnpm live:smoke
```

Expected at this commit: `pnpm check` exits 0 with 470 unit tests in 37 files (ten need PostgreSQL and are skipped
without `TEST_DATABASE_URL`). E2E: the full run of the suite in a clean checkout is made on this commit and recorded by the next one (`evidence/phase-16/e2e-run.txt`). `replay IDENTICAL`.

## Execution order (D-001)

01 ✔ → 02 ✔ → 03 ✔ → 04 ✔ → 05 ✔ → 09 ✔ → 10 ✔ → 06 ✔ → 07 ✔ → 08 (partial) → 11 (partial) → 12 (partial) →
13 (partial) → 14 ✔ → 15 (partial) → 16 ✔ → 17 (blocked) → **18** → 19 → 20

## Where things live

- `src/engine/**` — pure deterministic simulation (no DOM, no time, no `Math.random`; lint-enforced).
- `src/providers/**` — minds outside the engine, with no secrets: `wire.ts` (answer schema and translation),
  `prompt.ts` (prompt p2), `mock.ts` / `replay.ts` (free providers), `schedule.ts`, `run.ts` (epoch runner),
  `prices.ts` (dated price table, microdollar arithmetic).
- `src/server/**` — server only: `ledger.ts`, `auth.ts` + `http.ts` (the gate), `anthropic.ts` (live adapter
  and the guard around its `fetch`), `runs.ts` (lease, stored answers, recovery of interrupted calls, commit),
  `smoke.ts` (the live smoke test; `scripts/live-smoke.ts` is its only way in), `env.ts` (what live mode
  needs, the ceiling), `api.ts` (the owner API as functions; routes in `src/app/api` only forward).
  `db/migrations/*.sql` is the schema's source; run `pnpm gen:migrations` after changing it.
- `src/worker/sim.worker.ts` — owns the world, its twin and its history (moments, lines set aside, re-runs,
  rebuilding a loaded world's past, files, the event ledger); posts view frames of either world; plays
  recordings and checks them against the record; `protocol.ts` is the only contract with the page.
  `sim.worker.test.ts` drives it through that protocol with no browser.
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

1. **Phase 18, release.** Prepare everything that does not deploy: the deployment guide, the environment
   variable list, the checks to run against a preview. **Then ask the owner** before creating a Vercel
   project, a database or anything else that could be billed (`CLAUDE.md`: no paid infrastructure without
   approval). If there is no access or no approval, write the exact steps and mark the phase unverified.
2. **Phase 19** (scorecard) and **phase 20** (redesign and handoff). Candidates noted along the way: scenario
   aims that are evaluated; a per-shore measure for Two Shores; a resources overlay; a whole-society view of
   ties; a separate host for the owner console (D-039, D-042).
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

- **Whether to deploy at all**, and where the database would live (phase 18). Both may cost money.
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
