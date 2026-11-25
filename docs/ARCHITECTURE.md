# Architecture

Status: phase 02 deliverable · 2026-11-25 · decisions referenced as `D-0xx` live in `DECISIONS.md`.

## 1. Stack (version-matched to what is installed; see `pnpm-lock.yaml`)

| Concern | Choice | Why |
|---|---|---|
| App framework | Next.js 16.4 (App Router, Turbopack, Cache Components) on Node 22 | Static shells for every public page, Node route handlers for the owner API, first-class Vercel target. Conventions were read from the docs bundled in `node_modules/next/dist/docs`. |
| Language | TypeScript 5.9, `strict`, `noUncheckedIndexedAccess` | TS 7 exists but `typescript-eslint` does not yet support it. |
| Rendering | three.js 0.187 through an imperative, framework-free `WorldRenderer` (WebGL2) | Full control of the frame loop, instancing and shaders; React only draws the HUD (D-002). |
| UI state | React 19.3 + zustand | Small, explicit stores; the world itself never lives in React state. |
| Validation at trust boundaries | Zod 4 | Provider output, API bodies, imported bundles. |
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
    sim/         tick pipeline: environment → perception → decisions → validation → arbitration → application
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
   ticks). World generation uses doubles but only `+ − × ÷ floor sqrt`, which IEEE-754 defines exactly.
4. **Stable order.** Agents, nodes and structures are processed in id order; contested resources are arbitrated by
   a keyed random priority that rotates fairly and never favours low ids.
5. **Canonical bytes.** Snapshots serialize to canonical JSON (sorted keys, tagged little-endian typed arrays,
   non-finite numbers rejected) and are addressed by SHA-256. A fast 64-bit rolling digest is recorded per day.
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
decisions     baseline policies decide in-engine; external decisions are injected from the log
intents       agents with no action in progress start their next queued intent
validation    prerequisites, range, capacity, authority → accept or reject with reason code
arbitration   contested units are allocated by keyed random priority
application   state deltas + events (actor, tick, reason, quantities, causal parents)
institutions  triggers and periodic rules evaluated under a fuel limit; transfers conserve resources
bookkeeping   metric accumulators, rolling digest
```

Agents never write state. A model's output is parsed into the same `Intent` types the baseline policies emit and
passes through the same validation, arbitration and application code.

## 6. Hosts

| Host | Runs | Notes |
|---|---|---|
| Browser Web Worker | Free play, title vista, counterfactual forks, Lab batches | Posts compact view frames to the UI; snapshots and ledgers go to IndexedDB. |
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
- A budget refusal (kill switch, run cap, daily cap, total) **pauses** the run with its epoch still open; an
  error no retry can fix **fails** it; a cancelled run is final. Nothing is asked of anyone in any of those states.
- A **recording** is a run's configuration, tape and digests. The browser rebuilds the world from those in its
  own worker, consulting no mind, and checks every epoch's digest. A visitor can fetch the recording of a
  published run; one mock recording is bundled as a static file.
- No resident process, no in-memory budget, no workflow or queue service. The platform limits that bound a
  step's duration are in `docs/research/vercel-platform.md` (the step route asks for 300 seconds).

## 8. Persistence

| Data | Free play | Live run |
|---|---|---|
| Snapshots (content-addressed) | IndexedDB: one per named save and one autosave (every second day), each stored with its SHA-256 and refused on load if it no longer matches. In the worker's memory only: gzip keyframes of the line being lived (the start and every second morning, at most 24) and the last state of each line set aside | PostgreSQL: the latest only (gzip); earlier states are rebuilt by replaying the tape |
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
| Provider 4xx/5xx with a definite error | Reservation released; at most a bounded number of new attempts, each separately reserved. |
| Malformed or unsafe model output | Rejected, logged with reason; the agent falls back to its labelled reflex policy. |
| Function killed mid-epoch | Lease expires; the next step resumes from stored decisions without re-dispatching completed ones. |
| Tab closed / phone suspended | The worker stops; saves are transactional, so the last committed day is intact. |
| Two tabs | Each tab has its own worker and its own world; named saves have unique ids and never collide. The autosave slot is shared: the last tab to autosave replaces it whole (a save is one transaction, never a mixture). No lease is taken — an earlier version of this document said one was; see phase 15. |
| Corrupted or tampered import | Hash and schema checks fail and the import is refused with a specific reason. |
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
pnpm check        # lint + typecheck + test + build
```
