# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m` · PR: https://github.com/JaredVogler2/TABULA-RASA/pull/1
- **Phase:** 10 PASS. **Next: phases 06–08** (Claude adapter, budget ledger and security, orchestration).
- **Last verified commit:** see `git log -1`.
- **Spend:** $0. No API key present. Live mode must stay disabled until the owner authorizes a capped run.

## Verify the tree

```bash
pnpm install --frozen-lockfile
pnpm check        # lint + typecheck + unit + affordance-doc freshness + build
pnpm e2e          # Playwright, production build, desktop + phone emulation (about 4 minutes on a CPU renderer)
pnpm sim -- --scenario first_light --seed 1 --days 40 --policy planner --replay
pnpm bench
pnpm compare -- --seeds 1-4 --days 40                  # paired baselines, development seeds
pnpm exec tsx scripts/mixed.ts --seeds 1-4 --days 40   # planners and reflex agents on one island
pnpm exec tsx scripts/civics.ts --scenario long_winter --seeds 1-4 --days 30   # what institutions did, per mode
# art stills (needs `pnpm build && pnpm exec next start -p 3210` in another shell)
node scripts/shots.mjs /tmp/shots vista closeup dusk night phone
```

Expected at this commit: 166 unit/property tests pass; E2E 8 passed, 2 skipped (two tests are desktop-only);
`replay IDENTICAL`.

## Execution order (D-001)

01 ✔ → 02 (partial) → 03 ✔ → 04 ✔ → 05 ✔ → 09 ✔ → 10 ✔ → **06** → 07 → 08 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

## Where things live

- `src/engine/**` — pure deterministic simulation (no DOM, no time, no `Math.random`; lint-enforced).
- `src/worker/sim.worker.ts` — owns the world and its untouched twin; posts view frames; `protocol.ts` is the
  only contract with the page.
- `src/render/**` — imperative three.js (`WorldRenderer`); never imported by the engine, never imports React.
- `src/ui/game/**` — React HUD and panels; `controller.ts` is the single place that talks to worker + renderer.
- `src/store/game.ts` — zustand view state; `src/persist/saves.ts` — IndexedDB saves.
- `src/app/studio` + `scripts/shots.mjs` — capture harness for art QA (D-013).

## Next actions

1. Phase 06: provider interface (Mock / Replay / Baseline / LiveAnthropic) behind `src/engine/mind/external.ts`
   (`observe`, `submitDecision`, `dueForDecision`, `tapeFromEvents`, `replayTape` are the whole contract;
   `mock.ts` is the reference mind); prompt templates and injection fixtures (S01); decision schema for
   structured outputs. Read `docs/research/anthropic-api.md` first. No key, no call, no spend.
2. Phase 07: Postgres/PGlite microdollar ledger with atomic reservation, owner auth, CSRF, kill switch, rate
   limits, secret and bundle scans (D-007, D-008). Scripts named in `package.json` but not yet written:
   `study`, `db:migrate`, `owner:hash`, `scan:secrets`, `scan:bundle`.
3. Phase 08: schedulers and the resumable epoch route (D-009).
4. Phase 14 must begin with a pilot that estimates the variance of paired differences (protocol §10, D-018).
5. Engine notes:
   - Model: `docs/ODD.md`; institutions: `docs/INSTITUTIONS.md`; baselines: `docs/COGNITION.md`; ecology: D-014;
     society measures: `src/engine/metrics/society.ts`. Never tune on holdout seeds (9000–9999).
   - Snapshots at 500 agents are ~36 MiB (dense belief arrays): sparse encoding is a phase 15 item.
6. Art items carried to phase 11 are listed in `docs/ART_BIBLE.md` § Known weaknesses.

## Blockers

None for offline work. Live API work (phase 17) is blocked on explicit owner authorization of a dollar ceiling.

## Conventions worth remembering

- Never use `Math.random`, `Date`, timers or transcendental `Math` functions under `src/engine` (lint error).
- Development seeds are 1–999; holdout seeds 9000–9999 are reserved for confirmatory studies.
- Bump `ENGINE_VERSION` when behaviour changes, `SCHEMA_VERSION` (with a migration) when saved shapes change,
  `AFFORDANCE_VERSION` (and the registry) when what agents can perceive or do changes.
- `docs/AFFORDANCES.md` is generated: `pnpm gen:affordances`.
- Next.js conventions: read `node_modules/next/dist/docs/` — this is Next 16 (Turbopack, `proxy.ts`, async
  request APIs, Cache Components).
