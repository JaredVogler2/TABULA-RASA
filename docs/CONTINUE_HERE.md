# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m` · PR: https://github.com/JaredVogler2/TABULA-RASA/pull/1
- **Phases:** 01–07, 09, 10 PASS · 08 PARTIAL (one item needs a model) · 17 BLOCKED (no spend authorized) ·
  **next: 11–12** (art passes, observer UX).
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
pnpm e2e          # Playwright, production build, desktop + phone emulation (about 7 minutes on a CPU renderer)
pnpm sim -- --scenario first_light --seed 1 --days 40 --policy planner --replay
pnpm bench
pnpm compare -- --seeds 1-4 --days 40                  # paired baselines, development seeds
pnpm schedulers -- --seeds 1-4 --days 6 --slots 8      # activation policies on the same worlds, mock minds, no cost
pnpm record -- --id mock-first-light --seed 7 --days 6 # re-record the bundled mock recording (verifies it replays)
pnpm exec tsx scripts/mixed.ts --seeds 1-4 --days 40   # planners and reflex agents on one island
pnpm exec tsx scripts/civics.ts --scenario long_winter --seeds 1-4 --days 30   # what institutions did, per mode
# art stills (needs `pnpm build && pnpm exec next start -p 3210` in another shell)
node scripts/shots.mjs /tmp/shots vista closeup dusk night phone
```

Expected at this commit: 290 unit/property tests pass and 1 is skipped by design (the live smoke test, which
prints "NOT authorized"); without `TEST_DATABASE_URL` eleven more are skipped by name. E2E: 17 passed, 3 skipped
(desktop-only tests). `replay IDENTICAL`.

## Execution order (D-001)

01 ✔ → 02 ✔ → 03 ✔ → 04 ✔ → 05 ✔ → 09 ✔ → 10 ✔ → 06 ✔ → 07 ✔ → 08 (partial) → **11** → 12 → 13 → 14 → 15 → 16 →
17 (blocked) → 18 → 19 → 20

## Where things live

- `src/engine/**` — pure deterministic simulation (no DOM, no time, no `Math.random`; lint-enforced).
- `src/providers/**` — minds outside the engine, with no secrets: `wire.ts` (answer schema and translation),
  `prompt.ts` (prompt p1), `mock.ts` / `replay.ts` (free providers), `schedule.ts`, `run.ts` (epoch runner),
  `prices.ts` (dated price table, microdollar arithmetic).
- `src/server/**` — server only: `ledger.ts`, `auth.ts` + `http.ts` (the gate), `anthropic.ts` (live adapter),
  `runs.ts` (lease, stored answers, commit), `api.ts` (the owner API as functions; routes in `src/app/api`
  only forward). `db/migrations/*.sql` is the schema's source; run `pnpm gen:migrations` after changing it.
- `src/worker/sim.worker.ts` — owns the world and its untouched twin; posts view frames; plays recordings and
  checks them against the record; `protocol.ts` is the only contract with the page.
- `src/render/**` — imperative three.js (`WorldRenderer`); never imported by the engine, never imports React.
- `src/ui/game/**` — React HUD and panels; `controller.ts` is the single place that talks to worker + renderer.
  `src/ui/owner/Console.tsx` — the owner console at `/owner`.
- `src/store/game.ts` — zustand view state; `src/persist/saves.ts` — IndexedDB saves.
- `src/app/studio` + `scripts/shots.mjs` — capture harness for art QA (D-013).

## Next actions

1. **Phases 11–12.** Art items carried from phase 04 are in `docs/ART_BIBLE.md` § Known weaknesses (citizens
   beside nodes, stream banks, ambient life, sound, institution artifacts). Observer UX: knowledge and
   social-network overlays, institution ledger, timeline scrub, accessibility pass. The recording banner and
   the owner console are new surfaces that have had one visual pass only.
2. **Phase 13**: persisted ledger, branch tree, export/import with integrity checks. A recording is already an
   exportable, verifiable artifact; saves are not yet.
3. **Phase 14** must begin with a pilot that estimates the variance of paired differences (protocol §10,
   D-018), and should treat "share of time on own plan" as a manipulation check (D-023).
4. **Phase 17 is blocked on the owner.** What is needed, in order, is in `docs/COST.md` § First live call. The
   first authorized call should be the smoke test (`src/server/live.integration.test.ts`): it will show for the
   first time whether the provider accepts the answer schema, and what a decision really costs.
5. Engine notes:
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
