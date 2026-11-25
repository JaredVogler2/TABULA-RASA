# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m` · PR: https://github.com/JaredVogler2/TABULA-RASA/pull/2
  (pull request 1, phases 01–05, 09 and 10, was merged to `main` by the owner on 2026-11-25).
- **Phases:** 01–07, 09, 10, 14 PASS · 08 PARTIAL (one item needs a model) · 11, 12 PARTIAL (no GPU, no device,
  no human playtest) · 13 PARTIAL (no live recording exists to compare with) · 17 BLOCKED (no spend
  authorized) · **next: 15–16** (performance and scale; adversarial QA), then the confirmatory study batch.
- **Last verified commit:** see `git log -1`.
- **Spend:** $0. No API key has ever been present. The application's authorized budget is zero and its kill
  switch is on. **Nothing has been sent to the provider**: the request shape, the schema's acceptance and every
  cost figure are unverified against the real API.

## Verify the tree

```bash
pnpm install --frozen-lockfile
# the ledger's concurrency tests and the owner console's E2E need a PostgreSQL server:
#   service postgresql start   (role tabula / password tabula / database tabula_test, as in CI)
export TEST_DATABASE_URL=postgres://tabula:tabula@localhost:5432/tabula_test
pnpm check        # lint, typecheck, unit, generated-doc freshness (affordances, migrations, prompts), secret scan, build, bundle scan
pnpm e2e          # Playwright, production build, desktop + phone emulation (about 35 minutes on a CPU renderer; --project=desktop for one)
pnpm sim -- --scenario first_light --seed 1 --days 40 --policy planner --replay
pnpm bench
pnpm compare -- --seeds 1-4 --days 40                  # paired baselines, development seeds
pnpm schedulers -- --seeds 1-4 --days 6 --slots 8      # activation policies on the same worlds, mock minds, no cost
pnpm record -- --id mock-first-light --seed 7 --days 6 # re-record the bundled mock recording (verifies it replays)
pnpm exec tsx scripts/mixed.ts --seeds 1-4 --days 40   # planners and reflex agents on one island
pnpm exec tsx scripts/civics.ts --scenario long_winter --seeds 1-4 --days 30   # what institutions did, per mode
# the laboratory (costs nothing; development seeds only unless --confirmatory --plan <file>)
pnpm study -- --study all --seeds 1-16 --out /tmp/pilot                 # every registered condition; resumable, --shard i/N
pnpm study -- --analyse --study all --seeds 1-16 --out evidence/phase-14/pilot   # report from finished runs only
pnpm study -- --verify 12 --study all --seeds 1-16 --out evidence/phase-14/pilot # re-run cells, compare hashes
# the top bar at 25 window widths (needs a running server, as for the stills)
node scripts/topbar.mjs http://127.0.0.1:3210 /tmp/topbar
# art stills (needs `pnpm build && pnpm exec next start -p 3210` in another shell)
node scripts/shots.mjs /tmp/shots vista closeup forager woodcutter charter knowledge dusk night phone low
```

Expected at this commit: 371 unit/property tests pass and 1 is skipped by design (the live smoke test, which
prints "NOT authorized"); without `TEST_DATABASE_URL` eleven more are skipped by name. E2E: 25 passed, 3 skipped
(desktop-only tests); it takes about 35 minutes for both projects on a CPU renderer, of which the history flow
is seven minutes a project (CI runs the two projects as separate jobs). `replay IDENTICAL`.

## Execution order (D-001)

01 ✔ → 02 ✔ → 03 ✔ → 04 ✔ → 05 ✔ → 09 ✔ → 10 ✔ → 06 ✔ → 07 ✔ → 08 (partial) → 11 (partial) → 12 (partial) →
**13** → 14 → 15 → 16 → 17 (blocked) → 18 → 19 → 20

## Where things live

- `src/engine/**` — pure deterministic simulation (no DOM, no time, no `Math.random`; lint-enforced).
- `src/providers/**` — minds outside the engine, with no secrets: `wire.ts` (answer schema and translation),
  `prompt.ts` (prompt p1), `mock.ts` / `replay.ts` (free providers), `schedule.ts`, `run.ts` (epoch runner),
  `prices.ts` (dated price table, microdollar arithmetic).
- `src/server/**` — server only: `ledger.ts`, `auth.ts` + `http.ts` (the gate), `anthropic.ts` (live adapter),
  `runs.ts` (lease, stored answers, commit), `api.ts` (the owner API as functions; routes in `src/app/api`
  only forward). `db/migrations/*.sql` is the schema's source; run `pnpm gen:migrations` after changing it.
- `src/worker/sim.worker.ts` — owns the world, its twin and its history (moments, lines set aside, re-runs,
  rebuilding a loaded world's past, files, the event ledger); posts view frames of either world; plays
  recordings and checks them against the record; `protocol.ts` is the only contract with the page.
  `sim.worker.test.ts` drives it through that protocol with no browser.
- `src/engine/save/history.ts` — manifests, bundles (export/import with integrity checks), replay from a state.
- `src/lab/**` — `studies.ts` (the registered hypotheses as data, `runCell`), `stats.ts`, `analyse.ts`
  (reports, verdict rules, sizing), `cost.ts` (ceilings for live designs); `scripts/study.ts` is the batch
  runner; `/lab` (`src/ui/lab/Lab.tsx`) reads `public/studies/**`.
- `src/render/**` — imperative three.js (`WorldRenderer`); never imported by the engine, never imports React.
  `citizens.ts` (figures, props, the faint shape of hidden people), `ambient.ts` (smoke, fish rises, birds),
  `overlays.ts` (what a citizen knows; ties), `structures.ts` (buildings, agreements' posts and pennants).
- `src/audio/soundscape.ts` — procedural sound; reads state, changes nothing; silent until asked for.
- `src/ui/game/**` — React HUD and panels; `controller.ts` is the single place that talks to worker + renderer.
  `Atlas.tsx` (map and almanac), `Journal.tsx` + `journal.ts` (field journal), `Inspector.tsx`,
  `History.tsx` (moments, world lines, files), `Compare.tsx`.
  `src/ui/owner/Console.tsx` — the owner console at `/owner`.
- `src/store/game.ts` — zustand view state; `src/persist/saves.ts` — IndexedDB saves.
- `src/app/studio` + `scripts/shots.mjs` — capture harness for art QA (D-013).

## Next actions

1. **What phases 11–12 could not do here** (needs the owner or a device): look at it on a real GPU and a real
   phone and record frame rates; listen to the sound; have someone who did not build it play the first
   fifteen minutes; try a screen reader. `docs/ART_BIBLE.md` § Known weaknesses and `docs/OBSERVER_UX.md` list
   what else is open.
2. **Phase 15** (performance and scale): profile before optimizing; benchmarks at 50/100/250/500 agents;
   frame time, worker latency, memory, save size, draw calls; sparse belief snapshots; a guard for two tabs
   sharing the autosave slot (`docs/ARCHITECTURE.md` §9 says plainly that none exists yet).
3. **Phase 16** (adversarial QA): an independent pass over accounting, authority, isolation, budget, auth,
   malformed provider output, and every claim in the docs against the code (two false claims were found in
   `ARCHITECTURE.md` during phase 13 and corrected: look for more).
4. **The confirmatory batch** (D-037): only after phases 15–16 stop changing the engine. Then, once:
   `pnpm study -- --study all --seeds 9000-9031 --confirmatory --plan evidence/phase-14/pilot/plan.json --out evidence/phase-14/confirmatory`,
   publish the bundle under `public/studies/` and report it as it comes out — the pilot suggests the positive
   control (H6a) will fail. Do not tune anything toward it.
5. **Phase 17 is blocked on the owner.** What is needed, in order, is in `docs/COST.md` § First live call. The
   first authorized call should be the smoke test (`src/server/live.integration.test.ts`): it will show for the
   first time whether the provider accepts the answer schema, and what a decision really costs.
6. Engine notes:
   - Model: `docs/ODD.md`; institutions: `docs/INSTITUTIONS.md`; baselines: `docs/COGNITION.md`; ecology: D-014;
     society measures: `src/engine/metrics/society.ts`. Never tune on holdout seeds (9000–9999).
   - Snapshots at 500 agents are ~36 MiB (dense belief arrays): sparse encoding is a phase 15 item. Server-side
     runs are limited to 120 people for that reason.

## Open questions for the owner (none of them blocks offline work)

- **Which model?** `ANTHROPIC_MODEL` has no default. Per-call upper bounds are in `docs/COST.md`.
- **A dollar ceiling for a smoke test** (suggested: $2), then separately for a pilot.
- **A PostgreSQL database** for the owner console and server-side runs (a billable or free-tier resource the
  owner must approve), and whether to deploy to Vercel at all (phase 18).

## Blockers

None for offline work. Live API work (phase 17) and the last item of phase 08 are blocked on explicit owner
authorization of a dollar ceiling.

## Conventions worth remembering

- Never use `Math.random`, `Date`, timers or transcendental `Math` functions under `src/engine` (lint error).
- Development seeds are 1–999; holdout seeds 9000–9999 are reserved for confirmatory studies.
- Bump `ENGINE_VERSION` when behaviour changes, `SCHEMA_VERSION` (with a migration) when saved shapes change,
  `AFFORDANCE_VERSION` (and the registry) when what agents can perceive or do changes.
- `docs/AFFORDANCES.md` is generated: `pnpm gen:affordances`.
- Next.js conventions: read `node_modules/next/dist/docs/` — this is Next 16 (Turbopack, `proxy.ts`, async
  request APIs, Cache Components).
