# Decision log

Every material change to the prompt program's proposals is recorded here (CLAUDE.md, "Fable's design authority").
Fields: problem · original proposal · alternatives · evidence · decision · affected acceptance tests · cost/risks ·
rollback. Read this file before modifying any contract it mentions.

---

## D-001 — Phase ordering: institutions and economy before the Claude adapter (2026-11-25)

- **Problem.** The model-decision schema of phase 06 must be able to carry institution proposals (phase 09) and
  economic intents (phase 10). Building the adapter first would force a throw-away schema v1. Phase 04 also needs
  survivable baseline agents, which the program places in phase 05.
- **Original proposal.** Execute 01 → 20 in numeric order.
- **Alternatives.** (a) Numeric order with a later schema migration; (b) reorder.
- **Evidence.** Dependency reading of the prompts: 06 references "bounded rule proposal AST" (S01) that only
  exists after 09; 04's gate requires "deterministic heuristic agents … capable of survival".
- **Decision.** Execution order: 01, 02, 03 (+ reflex baseline), 04, 05, 09, 10, 06, 07, 08, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20. Art starts in 04 and is iterated continuously; phase numbers and gates are unchanged.
- **Affected acceptance tests.** None weakened; S04 items keep their numbering.
- **Cost / risks.** Paid-path plumbing arrives later in the calendar; mitigated because no spend is authorized.
- **Rollback.** Not applicable (ordering only).

## D-002 — Imperative three.js renderer instead of React Three Fiber (2026-11-25)

- **Problem.** The world needs thousands of instanced meshes, custom shaders, a hand-tuned post-processing chain
  and a frame loop decoupled from React renders, on phones as well as desktops.
- **Original proposal.** "Suggested Next.js + TypeScript + React Three Fiber/Three.js".
- **Alternatives.** R3F + drei; raw three.js; WebGPU renderer.
- **Evidence.** The renderer consumes typed-array frames from a worker at tick rate and interpolates at display
  rate; none of that state belongs in React. A reconciler adds per-frame overhead and a second mental model for
  instancing. WebGPU cannot be benchmarked on real devices from this environment (headless Chromium here reports
  `navigator.gpu` absent), and WebGL2 is available on every targeted browser (Safari 16.4+).
- **Decision.** A framework-free `WorldRenderer` (three.js, WebGL2) mounted by one React component; React draws
  only the HUD. WebGPU is not used (prompt 11: "WebGPU only if benchmarked").
- **Affected acceptance tests.** S04-10/11 unchanged.
- **Cost / risks.** No declarative scene graph; mitigated by small renderer modules with explicit `dispose`.
- **Rollback.** The renderer sits behind `src/render` with a narrow interface; an R3F implementation could replace
  it without touching engine or UI stores.

## D-003 — Determinism by construction: keyed RNG, integer state, restricted math (2026-11-25)

- **Problem.** Replay, forks, matched-seed experiments and server/client state verification all require
  bit-identical simulation across Node, browsers and workers.
- **Original proposal.** "deterministic PRNG with separate per-agent/per-process streams", "fixed-point/integer
  accounting where sensible".
- **Alternatives.** Stateful per-agent generators (xoshiro/sfc32) stored in the snapshot; a counter-based keyed
  generator; Rust/WASM core.
- **Evidence.** `Math.sin/exp/pow` are implementation-defined in ECMAScript, whereas `+ − × ÷ sqrt` are exact
  under IEEE-754. A counter-based generator makes every draw a pure function of `(seed, stream, keys)`, removing
  order-dependence and making "common random numbers" across forks a one-key change. The pinned self-test digest
  matches between Node 22, Chromium main thread and a Chromium worker (`tests/e2e/diagnostics.spec.ts`).
- **Decision.** MurmurHash3-based keyed draws (`src/engine/core/rng.ts`); integer simulation quantities; no
  transcendental math in `src/engine` (lint-enforced); canonical JSON + SHA-256 for snapshots.
- **Affected acceptance tests.** S04-2, S04-6 (strengthened: cross-runtime digest test added).
- **Cost / risks.** Hand-rolled approximations (e.g. `sinTurn`) for seasonal curves; cross-*browser-engine*
  equality (Safari/Firefox) is expected from the spec but **not tested here** and is reported as such.
- **Rollback.** None needed; stateful generators could be layered on the same primitive.

## D-004 — Engine purity and server isolation enforced by lint and `server-only` (2026-11-25)

- **Problem.** "Never import secrets into client bundles"; the engine must be shared unchanged by browser, worker,
  Node and server.
- **Original proposal.** Separate modules (prompt 02).
- **Alternatives.** Monorepo packages with separate builds; a single package with enforced import rules.
- **Decision.** One package; ESLint `no-restricted-imports/globals/properties` rules make boundary violations
  build-breaking; server modules import `server-only`; a bundle scan (phase 07) greps the client output.
- **Cost / risks.** Lint rules can be bypassed with disables — the bundle and secret scans are the backstop.
- **Rollback.** Split into workspace packages if the codebase outgrows a single package.

## D-005 — Framework configuration: Cache Components on, static shells, logic in route handlers (2026-11-25)

- **Problem.** Next.js 16 changed caching, rendering and file conventions relative to earlier versions.
- **Evidence.** Bundled docs (`node_modules/next/dist/docs`): Turbopack is the default bundler, `middleware`
  became `proxy` (Node runtime only), request APIs are async, `next lint` was removed, route handlers run at
  request time unless prerenderable, and `dynamic`/`revalidate` segment options are unavailable with Cache
  Components. The official template enables `cacheComponents` and `partialPrefetching`.
- **Decision.** Keep the template defaults. Every page is a static shell with client components; no page reads
  cookies or headers during render. All authenticated and stateful logic lives in `app/api/*` route handlers.
  Security headers, including a non-nonce CSP (documented approach that preserves static rendering), are set in
  `next.config.ts`.
- **Cost / risks.** The CSP needs `'unsafe-inline'` for scripts and styles; mitigations in `SECURITY.md`.
- **Rollback.** Switch to nonce-based CSP via `proxy.ts` (forces dynamic rendering) if the threat model changes.

## D-006 — Institution grammar grounded in the ADICO syntax and IAD rule types (2026-11-25)

- **Problem.** Prompt 09 asks for "generic predicates, conditions, permissions, commitments, membership, resource
  transfers, obligations, expiry and dispute/withdrawal mechanisms" without preprogrammed institutions. An ad-hoc
  list of rule templates would be hard to defend as generic.
- **Original proposal.** A bounded typed rule grammar (unspecified structure).
- **Alternatives.** (a) Parameterised templates ("granary", "market"); (b) a general event-condition-action
  language; (c) a grammar organised by an established institutional-analysis framework.
- **Decision.** (c): charters are composed of *constitutive* parts (position, boundary, aggregation and scope
  rules: roles, membership, decision procedures, controlled stores) and *regulative* statements in ADICO form
  (Attributes, Deontic `may|must|must_not`, aIm, Conditions, Or-else), plus bounded *payoff* procedures (automatic
  transfers, bonds, sanctions). Authority is **consent-bounded**: a rule can move only resources that members
  placed under institutional control, and can sanction only by forfeiting a member's bond, suspending
  entitlements or expelling. Exit is always possible. Narrative text (name, purpose, role labels) has no
  executable effect.
- **Evidence.** Design-level; literature basis is recorded in `LITERATURE.md` once verified. Expressiveness is
  tested in phase 09 (exchange, mutual aid, funded infrastructure) and safety by fuzzing.
- **Affected acceptance tests.** S04-5 (strengthened: conservation and authority invariants are properties).
- **Cost / risks.** The grammar itself is a prior over what institutions can exist (disclosed in AFFORDANCES).
- **Rollback.** Grammar is versioned; charters record their grammar version.

## D-007 — Direct Anthropic API with the owner's key; no fallbacks, no gateway (2026-11-25)

- **Problem.** Owner credits must be what is charged; the contract forbids silent substitutes.
- **Original proposal.** "server-only direct provider or verified BYOK route".
- **Alternatives.** Vercel AI Gateway (BYOK or gateway credits); `@ai-sdk/anthropic`; official `@anthropic-ai/sdk`.
- **Decision.** Official `@anthropic-ai/sdk` from server route handlers, key from `ANTHROPIC_API_KEY`, model from
  `ANTHROPIC_MODEL` (no default: unset means live mode is unavailable). SDK retries are disabled so every
  dispatch is individually reserved in the ledger. The API's optional server-side model `fallbacks` feature is
  **not** enabled: a refusal or unavailability is a recorded rejection followed by the labelled reflex fallback
  inside the simulation, never a different paid model.
- **Affected acceptance tests.** S04-7, S04-8.
- **Cost / risks.** A refused request still consumes its reservation's actual usage; documented in `COST.md`.
- **Rollback.** The `Provider` interface isolates the SDK; a gateway provider could be added as a separate,
  explicitly selected implementation.

## D-008 — Budget ledger on PostgreSQL semantics everywhere; PGlite locally (2026-11-25)

- **Problem.** "durable transactional ledger shared by all instances", "no in-memory authoritative budget", and
  "local dev requires no external services".
- **Alternatives.** SQLite locally and Postgres in production (two dialects); Redis counters; Postgres only.
- **Decision.** One SQL schema and one reservation algorithm (conditional `UPDATE … WHERE remaining >= amount
  RETURNING`, inside a transaction with a unique idempotency key), executed against `pg` in production and PGlite
  (file-backed) in development and CI. Real-concurrency tests run against a PostgreSQL 16 server when
  `TEST_DATABASE_URL` is set. Production refuses to start live mode without `DATABASE_URL`.
- **Affected acceptance tests.** S04-7.
- **Cost / risks.** PGlite is single-connection, so it cannot by itself prove concurrency safety — hence the
  additional real-server test. A managed Postgres is infrastructure the owner must approve.
- **Rollback.** The ledger is behind `LedgerStore`; another transactional store can implement it.

## D-009 — Client-driven, resumable epoch steps instead of a workflow service (2026-11-25)

- **Problem.** Live epochs make many provider calls and must survive function time limits without a resident
  process.
- **Original proposal.** "durable bounded steps and resumable jobs, polling or supported streaming"; research
  queues/workflows.
- **Alternatives.** A managed workflow/queue product; cron-driven workers; client-driven idempotent steps with a
  database lease.
- **Decision.** Client-driven steps with a lease, deterministic reservation ids and stored per-decision results
  (ARCHITECTURE §7). It needs only a database, works identically in local development, and adds no billable
  service. To be re-examined against `docs/research/vercel-platform.md` when that research lands.
- **Affected acceptance tests.** S04-7, S04-12.
- **Cost / risks.** A live run needs an open owner session (browser or CLI) to keep stepping.
- **Rollback.** The step function is a plain async function; a workflow runner can call it unchanged.

## D-010 — Non-LLM institutional innovation as an explicit, labelled treatment (2026-11-25)

- **Problem.** If only Claude can propose institutions, the free offline game has no institutional dynamics and
  the Lab has no non-LLM comparison. If heuristic agents propose from hand-written templates, that is scripted
  emergence.
- **Alternatives.** (a) No offline institutions; (b) templates; (c) agents search the rule grammar and select
  charters by their own utility model.
- **Decision.** (c) as treatment `grammar_search`: proposals are sampled from a documented distribution over the
  grammar and chosen by the proposing agent's own expected-utility estimate; other agents consent or decline with
  a generic evaluator. The distribution is a designer prior, listed in AFFORDANCES; origin is recorded on every
  institution; `off` and `scripted_control` arms exist; `scripted_control` never counts as emergence.
- **Affected acceptance tests.** S04-4 (strengthened: test that no institution can exist without an agent's
  validated proposal and individual consent events, and that `off` yields none).
- **Cost / risks.** Risk of readers over-interpreting search results as creativity; mitigated by labelling.
- **Rollback.** Set the treatment to `off`.

## D-011 — What agents can take from one another (2026-11-25)

- **Problem.** Property norms are only interesting if appropriation is physically possible, but the prompts
  require bounded, non-sensational coercion.
- **Decision.** Items on the ground and in *unbound* stores can be taken by anyone present; items carried on a
  body cannot be taken; there is no violence. Stores bound to an institution enforce that institution's access
  rules ("a lock"). All four facts are designer affordances and are disclosed.
- **Cost / risks.** No model of force means enforcement is limited to exclusion and forfeiture.
- **Rollback.** Affordance flags per scenario.
