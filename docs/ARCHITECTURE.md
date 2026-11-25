# Architecture

Status: phase 02 deliverable · 2026-11-25 · decisions referenced as `D-0xx` live in `DECISIONS.md`.

## 1. Stack (version-matched to what is installed; see `pnpm-lock.yaml`)

| Concern | Choice | Why |
|---|---|---|
| App framework | Next.js 16.4 (App Router, Turbopack, Cache Components) on Node 22 | Static shells for every public page, Node route handlers for the owner API, first-class Vercel target. Conventions were read from the docs bundled in `node_modules/next/dist/docs`. |
| Language | TypeScript 5.9, `strict`, `noUncheckedIndexedAccess` | TS 7 exists but `typescript-eslint` does not yet support it. |
| Rendering | three.js 0.187 through an imperative, framework-free `WorldRenderer` (WebGL2) | Full control of the frame loop, instancing and shaders; React only draws the HUD (D-002). |
| UI state | React 19.3 + zustand | Small, explicit stores; the world itself never lives in React state. |
| Validation at trust boundaries | Hand-written checks; no schema library | Provider output is read by `parseWire` (`src/providers/wire.ts`). API bodies pass `readJson` (`src/server/http.ts`: content type, size limit, well-formed JSON) and are then checked field by field in `src/server/api.ts` and by `validateSpec` (`src/providers/run.ts`). Imported bundles are opened by `openBundle` (`src/engine/save/history.ts`), and every restored world — a save, a file, a recording's start — passes `validateState` (`src/engine/save/validate.ts`: each field's type and range, stored charters against the grammar; D-043). What a model attaches to an intent is rebuilt from known fields and bounded (`src/engine/core/bounded.ts`; D-040). The phase-02 plan named Zod here; no file under `src/`, `scripts/` or `tests/` ever imported it, and it is no longer in `package.json`. |
| Tests | Vitest 5 + fast-check (unit/property/fuzz), Playwright 1.63 (desktop + phone emulation) | Playwright is pinned to the browser build available in CI and the dev container. |
| Free-play persistence | IndexedDB (browser) | No account, no server. |
| Live-run persistence and budget | PostgreSQL (production) / PGlite (local, tests) behind one SQL interface | Real transactions and row locks for the budget ledger; no external service needed for development (D-008). |
| Model provider | `@anthropic-ai/sdk` called directly from server route handlers with the owner's key | Owner credits are charged by Anthropic directly; no gateway, no silent substitutes (D-007). |

## 2. Module map and enforced boundaries

```
src/
  engine/        Pure deterministic simulation. Zero imports from outside this folder.
    core/        keyed RNG, hashing (StateHasher, SHA-256), canonical JSON, deterministic math
    world/       terrain, hydrology, biomes, resource nodes, seasons, weather
    model/       state types, constants, items, recipes, scenario configs
    sim/         tick pipeline (§5): environment → speech → bodies → perception → each agent in turn (decide →
                 validate and start → advance) → institutions → bookkeeping
    mind/        bounded cognition: beliefs, memory, trust, commitments, baseline policies
    institutions/ rule grammar (AST), validator, interpreter, lifecycle, grammar search
    metrics/     outcome measures defined in EXPERIMENT_PROTOCOL.md
    save/        snapshots, migrations, integrity
  providers/     Everything about minds outside the engine that needs no secret, shared by client,
                 server and scripts: the answer schema and its translation (wire), the prompt (prompt),
                 the provider contract and the Mock / Replay / Baseline providers, schedulers, the
                 epoch runner (run), the dated price table and cost arithmetic (prices)
  lab/           the registered studies as data, the cell runner, statistics, analysis and reports,
                 and the ceiling on what a live study could cost
  render/        three.js world renderer (no React)
  audio/         procedural sound
  worker/        Web Workers: simulation host (the world, its twin, its history), the laboratory's
                 re-run-one-cell check, self-test
  persist/       IndexedDB saves
  store/         UI stores and the worker client
  ui/            React components
  server/        SERVER ONLY: environment (env), database and embedded migrations (db), budget ledger,
                 owner auth and the request gate (auth, http), live Anthropic provider (anthropic),
                 run store and stepping (runs), the owner API as functions (api)
  app/           Next.js routes; app/api/* are the only server entry points
scripts/         headless simulation, benchmarks, studies, scans, migrations
tests/           e2e (Playwright), unit suites that span modules
```

Boundaries are lint errors, not conventions (`eslint.config.mjs`):

- `src/engine/**` may import only from `src/engine/**`; `Date`, timers, `fetch`, `console`, `Math.random` and
  every transcendental `Math` function are forbidden there.
- Only `src/server/**` and `src/app/api/**` may import `pg`, PGlite, the Anthropic SDK, `node:*` or `@/server/*`.
  Server modules additionally import `server-only`, so an accidental client import fails the build.
- `src/render/**` may not import React or UI code.

## 3. Determinism contract (D-003)

1. **No ambient inputs.** The reducer never reads the clock, locale, environment or unordered collections.
2. **Keyed randomness.** Every draw is `u32(seed, stream, k1..k4)` — a pure MurmurHash3 mix of the world seed, a
   named stream and integer keys such as `(tick, agentId, purpose)`. No generator state exists, so iteration order
   cannot leak between entities and forks can share or decorrelate exogenous randomness by changing one key.
3. **Exact arithmetic.** Simulation quantities are integers (needs in permille, inventory in units, time in
   ticks). Doubles are used in world generation, in the baseline minds' scoring (`mind/planner.ts`, `mind/civic.ts`,
   `institutions/judge.ts`) and in the metrics, but only with `+ − × ÷`, comparisons, `min`, `max`, `abs`, rounding
   to an integer and `sqrt`, which IEEE-754 and the language define exactly; every transcendental `Math` function
   is a lint error in `src/engine` (§2).
4. **Stable order.** Nodes and structures are walked in id order, and bodies and perception are updated agent by
   agent in id order. Decisions and actions run agent by agent in an order re-drawn every tick from a keyed random
   permutation (seed, tick, agent id and branch; ties by id), so nobody is systematically first: a contested unit
   goes to whoever comes first in that tick's order, and a claimant who finds nothing left is refused with the
   reason `contested`.
5. **Canonical bytes.** Snapshots serialize to canonical JSON (sorted keys, tagged little-endian typed arrays,
   non-finite numbers rejected) and are addressed by SHA-256. A fast 64-bit digest of the dynamic state
   (`worldDigest`, `src/engine/save/snapshot.ts`) is computed on demand, not by the tick pipeline: at the end of
   each decision epoch of a run or recording, in every manifest and study cell, when a re-run or a rebuilt past
   arrives where it left, and once a day by `pnpm sim` and the determinism tests.
6. **Cross-runtime check.** `/diagnostics` and the E2E suite assert that Node, the browser main thread and a Web
   Worker produce identical digests for a pinned workload.

## 4. Time

- `tick` — the fixed simulation step. 96 ticks = 1 day, 10 days = 1 season, 4 seasons = 1 year (3,840 ticks).
- **Micro-actions** (moving a tile, gathering, eating, building…) advance every tick under deterministic tactical
  control.
- **Strategic deliberation** happens when an agent is idle, interrupted, or — for external (model) minds — at
  **decision epochs** chosen by a scheduler. Between deliberations an agent executes its queued intents; if the
  queue is empty or invalid, a labelled fallback reflex keeps it alive.
- Rendering interpolates between ticks and never feeds back into the simulation.

## 5. Tick pipeline

```
environment   season/day/weather, temperature, regrowth, spoilage, fires, decay   (keyed RNG)
delivery      utterances from the previous tick reach hearers in range
bodies        need decay, health, death (a state transition with reason code)
perception    local observation → beliefs (with tick stamps and provenance)
agents        one agent at a time, in an order re-drawn every tick from a keyed random permutation
  interrupt     a need that has just become urgent pre-empts the plan
  decide        an agent with nothing queued gets a plan from its baseline policy (reflex, labelled fallback,
                for a mind outside the engine); outside decisions are submitted by the host between ticks
  start         the next queued intent is checked (prerequisites, range, capacity, authority) and begun,
                or refused with a reason code
  advance       the action in progress moves on; when it completes, its state changes are applied and its
                events written (actor, tick, reason, quantities, causal parents)
institutions  triggers and periodic rules evaluated under a fuel limit; transfers conserve resources
bookkeeping   once a day, a sample of inequality and commons health; the tick counter advances
```

Bodies and perception run in agent-id order. There is no separate arbitration pass: because the agents' turn
comes in a keyed random order, units that two of them want go to the one whose turn comes first that tick
(`src/engine/sim/step.ts`). Agents never write state. A model's output is parsed into the same `Intent` types the
baseline policies emit and passes through the same checking and completion code (`src/engine/sim/actions.ts`).

## 6. Hosts

| Host | Runs | Notes |
|---|---|---|
| Browser Web Worker | Free play, the title vista, the untouched twin and other world lines, replay of recordings (`sim.worker.ts`); the laboratory's re-run of one study cell (`lab.worker.ts`); the diagnostics self-test (`selftest.worker.ts`) | Posts compact view frames to the UI. The worker holds the world, its twin, its keyframes and the event ledger in memory and never touches IndexedDB; the page writes saves there (`src/persist/saves.ts`, §8). Study batches do not run in the browser (next row). |
| Node (scripts, Vitest) | Headless runs, benchmarks, studies, property tests | Same engine build. |
| Server route handlers | Owner-authorized live runs | Server-authoritative world; see §7. |

## 7. Server-side runs (D-009, as built: D-026)

- The **server** holds the authoritative world of a run as one compressed snapshot (the world at the first tick
  of the next epoch) plus, for every committed epoch, its tape of decisions and its state digest — all in
  PostgreSQL. A client never sends world state, prompt text, a model name or a key: it sends a run id.
- A **step** advances a run by at most one decision epoch and is safe to repeat at any time, from anywhere. It
  takes a database lease, rebuilds the world from the snapshot (and checks it against the stored digest),
  re-plans the epoch — the plan is a pure function of the world and the scheduler's state, so it is the same
  plan every time — asks only the minds that have no stored answer, and, when every mind in the plan has a
  final answer, offers the answers to the world in agent-id order, advances it, and commits snapshot, tape,
  digest and scheduler state in one transaction guarded by the epoch number and the lease.
- For a paid provider every attempt is **reserved in the ledger before it is sent**, under the deterministic id
  `run:epoch:agent:attempt`, and settled, released or marked unknown the moment its fate is known (D-021). A
  repeated or concurrent step can therefore never send or charge the same attempt twice.
- A budget refusal (kill switch, run cap, daily cap, total, or the deployment's ceiling) **pauses** the run
  with its epoch still open; so do three paid-for answers in a row that could not be used, and a charge that
  arrives after its reservation was released. An error no retry can fix — an answer from another model among
  them — **fails** it; a cancelled run is final. Nothing is asked of anyone in any of those states.
- What became of a request — settled, released or unknown — and the record of the call are written in **one
  transaction**; a step begins by finding every reservation of the run that has no record, whatever state it
  was left in, and writing one, so that a call cut off in flight is never asked again and never wedges the run
  (D-042).
- The amount that can ever be authorized is bounded by `BUDGET_CEILING_USD` in the server's environment,
  which the owner's console can read and cannot change. The request to the provider leaves through a guard
  that allows one method, one host and one path.
- A **recording** is a run's configuration, tape and digests. The browser rebuilds the world from those in its
  own worker, consulting no mind, and checks every epoch's digest. A visitor can fetch the recording of a
  published run; one mock recording is bundled as a static file.
- No resident process, no in-memory budget, no workflow or queue service. The platform limits that bound a
  step's duration are in `docs/research/vercel-platform.md` (the step route asks for 300 seconds).

## 8. Persistence

| Data | Free play | Live run |
|---|---|---|
| Snapshots (content-addressed) | IndexedDB: one per named save and one autosave (every second day), kept gzip-compressed, each with the SHA-256 of its canonical text and refused on load if it no longer unpacks to that text. In the worker's memory only: gzip keyframes of the line being lived (the start and every second morning, at most 24) and the last state of each line set aside | PostgreSQL: the latest only (gzip); earlier states are rebuilt by replaying the tape |
| Event ledger | In memory: the most recent 40,000 events (about six weeks of the reference world), with causal parents; downloadable as JSON Lines. Earlier events are not stored: they are produced again by re-living the world from its seed | Derivable by replay; decision log is authoritative |
| Decision log | In-engine for baseline policies; recorded for verification | PostgreSQL, append-only, with request hash, model, prompt version, usage |
| Branch tree | In the worker's memory for the session: parent, fork tick, same or new luck, interventions, content hash of each line set aside. Every world carries its own branch record (and travels with it in saves and files); lines set aside do **not** survive a reload unless saved or exported | A server run has one line |
| A world as a file | A bundle: state, twin, and a manifest (seed, configuration and hash, versions, branch, interventions, SHA-256); verified on import (D-033) | A recording: configuration, decision tape, state digest per epoch |
| Budget ledger | n/a | PostgreSQL, integer microdollars, transactional |

Schema versions are embedded in every artifact; `src/engine/save/migrate.ts` upgrades old saves and refuses
unknown future versions. As first written (phase 02) this table promised daily snapshots, an event ledger and a
branch tree in IndexedDB; what was built instead, and why, is D-033: the engine's determinism makes a world's
past cheaper to re-live than to store.

## 9. Failure modes designed for

| Failure | Behaviour |
|---|---|
| Database unreachable | Live endpoints return 503 and dispatch nothing (fail closed). Free play unaffected. |
| Provider timeout / dropped connection | Reservation becomes `unknown` and stays counted against every ceiling until the owner reconciles it. |
| Provider 4xx/5xx with a definite error | Reservation released; at most a bounded number of new attempts, each separately reserved. "Definite" means the provider's own error format with a request id: an error page from anything in between proves nothing, and is the row above. |
| Malformed or unsafe model output | Rejected, logged with reason; the agent falls back to its labelled reflex policy. |
| Function killed mid-epoch | Lease expires; the next step resumes from stored decisions without re-dispatching completed ones. A call that was in flight is found by its reservation, recorded as interrupted and held as unknown; it is not sent again. |
| A charge arrives after its reservation was released | Recorded in full as overage, which counts against every cap from then on; the kill switch turns on and is released only by typed words. |
| Tab closed / phone suspended | The worker stops, and what it held only in memory goes with it (keyframes, lines set aside, the event ledger: §8). A save is one IndexedDB transaction, so the stored autosave is whole or absent, never partial. The tab that holds the autosave slot (next row) writes it on every second simulated day, and again when the tab is hidden, which also pauses time (`onVisibility` in `src/ui/game/controller.ts`; the flow is in `tests/e2e/resilience.spec.ts`). A tab that dies without being hidden first loses what happened since its last autosave: up to two simulated days. |
| Two tabs | Each tab has its own worker and its own world; named saves have unique ids and never collide. The autosave slot has one owner at a time, decided by the browser's Web Locks: the first tab to need it keeps it until it closes; another tab is told that its world is not being autosaved and never overwrites the slot, then takes it up when the first tab is gone (`tests/e2e/resilience.spec.ts`). A save is one transaction, never a mixture. A browser without that API behaves as a single tab would. |
| Corrupted or tampered import | Hash, format and field-by-field checks fail and the import is refused with the place of the first thing wrong; goods must add up; the world is tried for half a simulated day before it is accepted. |
| An error inside a tick | The world stops behind a notice with one way on (the title); it is not autosaved over anything. |
| A renderer that cannot keep up | Resolution steps down, then — once, and only if the preset was automatic — the preset. The world is not told (`docs/PERFORMANCE.md`). |
| Unknown model or stale price table | Live mode refuses to start. |

## 10. Commands

```bash
pnpm dev          # local development (no external services)
pnpm lint
pnpm typecheck
pnpm test         # unit, property and fuzz tests
pnpm build
pnpm e2e          # Playwright against the production build (desktop + phone emulation)
pnpm sim          # headless seeded run with a text report
pnpm bench        # engine benchmarks
pnpm study        # offline study runner
pnpm load         # the budget ledger under contention (needs TEST_DATABASE_URL)
pnpm requests     # the server's own routes, timed (needs a build and TEST_DATABASE_URL)
pnpm live:smoke   # what is configured for live calls and what is missing; makes no request
pnpm check        # lint, typecheck, test, generated-file checks, secret scans, build, bundle scan
```

`docs/CONTINUE_HERE.md` has the full list with arguments.
