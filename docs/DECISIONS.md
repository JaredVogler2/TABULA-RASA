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
- **Rollback.** The ledger (`Ledger`, `src/server/ledger.ts`) is written against the small `Db` interface in
  `src/server/db.ts` (query, transaction, close), which `pg` and PGlite both implement; another transactional
  SQL store can implement it. (An earlier version of this line named a `LedgerStore` interface; none exists.)

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

## D-012 — The observer's hand always forks, against a twin that shares its luck (2026-11-25)

- **Problem.** The prompt asks for "intervene … compare outcome/debrief". A before/after view of one timeline
  cannot separate the intervention from everything else that would have happened anyway, and would invite
  exactly the causal over-reading the project is meant to avoid.
- **Original proposal.** Save → reload → compare outcome.
- **Alternatives.** (a) Before/after on one world. (b) Re-run the control from tick 0 on demand. (c) Fork at
  the first intervention and keep an untouched twin running in the worker with common random numbers.
- **Evidence.** Engine tests already prove that a common-random-number fork retraces its parent exactly until
  something differs (phase 03, "branches"). Stepping the twin costs one extra engine step per tick
  (0.14 ms median at 50 agents).
- **Decision.** (c). The first intervention forks; the twin shares terrain, people, weather draws and luck and
  is stepped in lock-step. Compare shows both, labels the result one seed and one difference, and says that it
  is an anecdote, not a finding. Both worlds and both daily series are saved together.
- **Affected tests.** `play.spec.ts` (fork badge, Compare, reload keeps the fork).
- **Cost / risks.** Twice the engine work after a fork; saves double in size. A single paired run is still one
  seed — the Lab (phase 14) is where claims are made.
- **Rollback.** Drop the twin and fall back to (a); the snapshot format already treats the control as optional.

## D-013 — A capture harness inside the product, and what the low preset is for (2026-11-25)

- **Problem.** The art gate requires screenshots "from the actual working product" across several passes, at
  fixed cameras, seasons and hours; and this environment renders WebGL on the CPU, where the first low preset
  took 510 ms per frame and made the end-to-end test exceed three minutes.
- **Decision.** (1) `/studio` is a page of the shipped app that builds a world from URL parameters with the
  same worker and renderer as the game and exposes read-only stats (`scripts/shots.mjs` drives it). It can
  change nothing about a game in progress. (2) The low preset is a real, lighter scene — half-resolution
  terrain mesh, simplified canopies, no shadow or post passes, cheaper terrain and water shaders (549,974 →
  249,190 triangles, measured) — not a test-only code path. (3) All presets may lower internal resolution
  when frames stay long; still captures turn that off so evidence is rendered at the stated size. (Corrected
  2026-11-25: this said "to 60%". The floor is a pixel ratio of 0.6, reached in steps of 0.2: from the high
  preset's ratio of 2 that is 30% of its resolution along each axis, not 60%.)
  (4) `?q=` and `?pr=` let a visitor or a test force a preset or cap resolution; both affect drawing only.
- **Evidence.** `evidence/phase-04/render-budget.txt`, `frame-cadence-swiftshader.txt`; E2E 1.4–1.7 min.
- **Cost / risks.** One extra static route in the bundle. Frame statistics now report the interval between
  frames reaching the screen rather than the time spent in JavaScript, which is less flattering and correct.
- **Rollback.** Delete `src/app/studio` and `scripts/shots.mjs`; presets are independent of it.

## D-014 — Reference ecology: an island that can carry its people, and a commons that can still be destroyed (2026-11-25)

- **Problem.** With the phase-03 tables, fifty people needed about as much food as the island could produce
  under *perfect* management. Under any actual policy the commons were stripped by the first winter, winter
  die-back took every bush to zero, and because growth was proportional to standing stock a hungry population
  then pinned every patch at zero. On development seeds 1–6 both baselines were down to about five survivors of
  fifty by day 60 — at productivity ×1.0, ×1.2 and ×1.25 alike. There was no sustainable regime, so no room for
  an institution (or a player) to make a visible difference, and the "forgiving" first scenario was a death trap.
- **Original proposal.** Phase 03 deferred tuning until a planner existed.
- **Alternatives considered.** (a) Scale richness and regrowth only: a knife-edge — at ×1.15 most die, at ×1.25
  all survive year one, and year two collapses in both cases. (b) Lower metabolism: same knife-edge. (c) Fewer
  people: the brief asks for fifty. (d) Change the growth law so that what a *plant* yields does not depend on
  the fruit left on it, keep true stock-recruitment dynamics for fish and roots, and add slack.
- **Evidence.** `pnpm compare` on development seeds (commands and outputs in `evidence/phase-05/`). After the
  change, 8 seeds × 80 days: planners 50/50 alive on every seed; reflex-only mean 46.4, minimum 36. On the old
  tables (still reachable with `--set richness=1000 --set regrowth=1000 --set nodeDensity=1000`, apart from the
  growth law): about 19 of 50 alive after one year under either baseline.
- **Decision.** (d). Growth is `rate · (stock + base·K) · (1 − stock/K)`. `base` is 15% of capacity for berry
  bushes and reed beds, 3–4% for root patches and trees, **0 for fishing waters** (pure logistic, with the
  collapse threshold kept). Winter die-back stops at a dormant reserve of 25% of capacity for bushes and reeds —
  which the hungry can still eat, and then spring starts from nothing. Empty patches re-seed faster. Defaults
  become richness 1200, nodeDensity 1500, regrowth 1200. Calibration target, checked by arithmetic and by runs:
  the island feeds fifty with slack when patches are left half full and roughly two thirds of them when every
  patch is picked bare. Thin Commons and The Long Winter were rescaled to stay hard (Long Winter severity
  1500 → 1350, where planners on seed 1 keep 84% alive rather than 56%).
- **Affected tests.** Pinned reference digests (reflex and planner), node-scaling test, snapshot schema tests.
- **Cost / risks.** The first scenario is now gentle under the planner baseline: its optional aim (four in
  five through the winter) is usually met without help. Every number here was chosen on development seeds; the
  holdout seeds have not been touched. Berries are now a weak commons; fish, roots and timber remain strong ones.
- **Rollback.** `base` and `dormant` are per-kind constants; the three multipliers are config.

## D-015 — The planner baseline: individual foresight, no collective script (2026-11-25)

- **Problem.** The brief asks for a non-LLM baseline that is "not deliberately weak" and for distinct agents
  that "behave differently for documented reasons", while forbidding scripted institutions.
- **Decision.** A project chooser over a fixed repertoire (`docs/COGNITION.md`), every threshold tied to a
  named trait, skill or lived experience; seasonal foresight only from temperatures the agent has felt; social
  behaviour limited to giving, asking, repaying, pledging and telling. No institutional intent appears in its
  source (asserted by a test). The cadence gate was removed for baseline planners (they deliberate whenever
  idle; `cadence` now paces external minds) and a five-tick back-off follows any rejected plan.
- **Three mistakes found by running it, and fixed.** (1) Agents starved beside full stores because the urgent
  hunger path bypassed the planner; (2) planners ran hungrier than reflex agents because they never "topped
  up"; (3) hoarding perishables that then rotted drained the commons twice as fast as the reflex baseline —
  perishables now count toward today only, and the storable stock is built from roots, smoked fish and crops.
- **What it shows, honestly.** Individually much more robust than reflex agents in the same world (65.5% vs
  20.3% alive after a lean year); as a whole society on a lean island, no better (18.6 vs 18.8 of 50), and
  lower on the well-being measure everywhere because it works longer. That is a commons dilemma arising from
  the model. It is a development observation on development seeds, not a finding.
- **Cost / risks.** The repertoire is a designer prior (that food should be stored, crops sown, favours
  returned) and is disclosed in the affordance registry. A richer baseline narrows what a model-driven mind can
  add; a poorer one would flatter it.
- **Rollback.** `policy: "reflex"` runs the world without it.

## D-016 — One observation, one mask, one tape for every external mind (2026-11-25)

- **Problem.** Model-driven agents must not see hidden state, must not be able to write state, and their runs
  must be replayable at no cost.
- **Decision.** `buildObservation` is the only view an external mind gets and is assembled solely from the
  agent's own state, beliefs, memories and current senses (the same `senses.ts` the planner uses). Its `actions`
  list is the action mask. `submitDecision` enforces shape, limits (6 intents, 240-character rationale,
  160-character speech), the structural gate and the mask, and queues what survives through the same path as
  baseline plans. The ledger stores accepted intents, so the ledger *is* the replay tape.
- **Evidence.** `cognition.test.ts`: sentinel-leak tests, mask and limit tests, and a 4-day, 12-agent run driven
  by the mock mind that replays from its tape to an identical physical state and event sequence.
- **Cost / risks.** The mask lists options, not guarantees: the engine still rejects at execution time, with a
  reason the next observation will show as a memory. Observation size is bounded (≤ 14 places, 10 structures,
  10 people, 12 memories) but not yet measured in tokens — that belongs to phase 06.
- **Rollback.** None needed; baseline minds do not use it.

## D-017 — Institution grammar v1 as built, and five places it departs from the sketch in D-006 (2026-11-25)

- **Problem.** D-006 fixed the principles (constitutive / regulative / payoff parts; consent-bounded authority).
  Building and running it exposed cases the sketch had not decided.
- **Decision.** The grammar in `docs/INSTITUTIONS.md`. Departures and additions:
  1. **No automatic transfers.** D-006 listed them; goods do not move at a distance in this world, so every
     entitlement is a right to *withdraw in person*, and every obligation is something a member physically does.
  2. **Bonds are posted at the moment of signing**, held while a proposal is open and returned if it lapses.
     Collecting them at ratification let the proposer of the control charter fall out of its own institution.
  3. **Builders, not depositors, must consent to a lock.** Counting everyone who had ever put food in a store
     as a builder meant no communal store could ever be controlled.
  4. **What is inside a store when it is locked stays open to everyone.** Otherwise a lock silently took food
     that non-members had stored — expropriation, which D-006 forbids. Found by running the control arm.
  5. **Harvest limits are breached only when another member sees it.** The engine is a perfect notary of
     consent, deposits and votes, but not of what happens unobserved on the land. Monitoring costs effort,
     as in the commons literature the grammar is modelled on.
  6. **A hearth can be the object of a standing obligation** (`must_supply` to a campfire, optionally seasonal):
     the one recurrent public good this world has.
- **Evidence.** 31 tests: diagnostics for every refusal, fuzzing (arbitrary JSON never throws; random valid
  charters lived under by acting members never break the conservation audit and never take more than a bond),
  privilege tests (outsiders, late joiners, founder roles, amendments), capability demonstrations (exchange,
  mutual aid, funded infrastructure), determinism and snapshot round-trip with a living institution.
- **Affected tests.** Snapshot schema 3 with migration; `auditGoods` now counts custody, proposal bonds and pact escrow.
- **Cost / risks.** The grammar is a strong prior over what institutions can be: five rule forms, four
  sanctions (`note`, which only records the breach, and `forfeit`, `suspend`, `expel`), twelve public facts.
  Anything outside it is refused, with a reason, rather than approximated.
- **Rollback.** `institutions: "off"` removes every institutional affordance; charters carry their grammar version.

## D-018 — Grammar search, the judging rule, and an honest positive control (2026-11-25)

- **Problem.** D-010 requires a non-LLM source of proposals that is not a set of templates, and the protocol
  requires a positive control showing that institutions have something to do.
- **Decision.** (1) `search.ts`: eight random draws from a documented distribution over the grammar; the
  proposer keeps the one it rates best and proposes it only if it would sign it. (2) `judge.ts`: a single
  hand-written estimate of the worth of living under a charter, used for signing, voting, dues and leaving.
  (3) `scripted.ts`: a designer-written "Hearth and larder" charter, announced aloud by a store's builder,
  labelled `scripted` on the proposal, the institution, the Chronicle and the Charters panel.
- **Evidence (development seeds, not findings).** `evidence/phase-09/`: charters are proposed and ratified
  under both treatments; no survival benefit is demonstrated; an isolation experiment shows single-seed
  differences of up to 13 survivors from perturbations that involve no institution at all.
- **What follows.** The Lab (phase 14) must estimate paired-difference variance in a pilot before sizing any
  study. If H6a fails on holdout seeds, the protocol's consequence applies: institutional affordances are not
  shown to be materially useful in this world and no E5 claim may be made until the ecology or the affordances
  are redesigned and re-registered.
- **Cost / risks.** The judging rule and the search distribution are designer priors; a different rule would
  produce different uptake. Both are disclosed in the affordance registry and in the interface.
- **Rollback.** `institutions: "off"`, or `"open"` with model-driven minds only.

## D-019 — The answer format is flat, and a charter carries its formulas as text (2026-11-25)

- **Problem.** A model must return a decision and, when it writes an agreement, nested formulas. The provider's
  structured outputs forbid recursive schemas and cap optional and union-typed fields
  (`docs/research/anthropic-api.md` §D.2), and this model cannot be forced to call a tool.
- **Original proposal.** Phase 06: `{agentId, observationVersion, intents:[{kind, targetId, quantity, duration,
  args}], utterances, memoryUpdates, publicRationale, uncertainty}`; S01: "optional bounded rule proposal AST".
- **Alternatives.** (a) a union of one object shape per intent kind (26 variants: union count and grammar size
  at risk); (b) free JSON checked afterwards (no guarantee of shape); (c) strict tool use (cannot be forced on
  Fable 5.2); (d) one flat record per action, with formulas written as text.
- **Decision.** (d), `src/providers/wire.ts`. An action is one record — `do` plus at most fifteen optional
  fields. A charter block has every field required and writes each quantity and condition as a short line of
  arithmetic that `parseFormula` (engine, `institutions/formula.ts`) turns into the grammar's own formula tree.
  Mapping from the proposed shape: `utterances` are `say` actions; `publicRationale` is `why` ("one short
  sentence you would say aloud"); `uncertainty` is `confidence`; `memoryUpdates` became `cites` (labels of the
  page lines the decision rests on) and `note` (D-022). `agentId` and `observationVersion` are not asked of the
  model: the server knows which page it sent. Translation never repairs meaning — an unreadable action is
  dropped with a reason that is fed back; a charter with one unreadable rule is dropped whole.
- **Evidence.** `wire.test.ts`: 400-case round-trip property over every intent kind; 360 charters drawn from the
  grammar-search distribution survive the wire unchanged; 300-case fuzz of hostile answers with the conservation
  audit clean. `formula.test.ts`: 800-case write-and-read-back property, 1,500-case fuzz. `lintSchema` checks
  both schemas against every documented limit and is itself tested with eleven deliberate violations.
- **Not verified.** That the provider's grammar compiler accepts the schema. That needs a live call.
- **Affected acceptance tests.** S04-8 (strengthened: round-trip and lint are now part of `pnpm test`).
- **Cost / risks.** A model may write a formula the grammar cannot express and lose the whole charter until its
  next decision. Text formulas are a wider input surface than a tree; hence the fuzzing.
- **Rollback.** The schema is selected by `WIRE_VERSION`; another format can be added beside it.

## D-020 — Reservations are bounded by bytes; a preview is a bound, not an estimate (2026-11-25)

- **Problem.** The ledger must hold, before a request is sent, the most that request can cost. That needs an
  upper bound on input tokens. No tokenizer is available offline; the provider's token counter is documented as
  "an estimate" and needs the key and a request of its own.
- **Alternatives.** (a) characters ÷ N (not a bound); (b) `count_tokens` per request plus a margin (tighter, not
  a bound, one more request per decision); (c) bytes.
- **Decision.** (c). A token is never shorter than one byte, so the UTF-8 length of everything sent (rules text,
  page, schema) bounds the visible input for any tokenizer. To that are added 2,000 tokens for what the provider
  inserts unseen (its structured-output and thinking prompts; size undocumented), every input token is priced at
  the dearest applicable rate (a 5-minute cache write), every permitted output token is priced (thinking is
  billed as output and counts against `max_tokens`), and 10% is added because a workspace's default inference
  geography can multiply every price by 1.1. Requests send `inference_geo: "global"`. The page has a hard limit
  of 9,000 bytes. If a settled cost ever exceeds its reservation, the excess is recorded as overage and the kill
  switch turns on.
- **Evidence.** `wire.test.ts` › "no usage a request could report costs more than was reserved for it"
  (3,000 cases across all priced models, cache mixes and geographies). `evidence/phase-08/schedulers.txt`: the
  bound averages 18,800 input tokens a call, i.e. about $0.32 reserved per Fable 5.2 call at 2,000 output tokens.
- **Consequence, stated plainly.** The reservation is expected to be several times the real cost. A run is
  created only if its worst case fits its cap, unless the owner ticks "let the run pause when the cap is
  reached". Unused reservation is returned as each call settles. Previews show the bound, and show measured
  costs only once real calls have settled through the ledger; until then there is nothing measured to show.
- **Follow-up.** After an authorized smoke run the ratio of tokens to bytes will be known. A calibrated bound
  could then be adopted by a new decision; it would no longer be provable, only observed.
- **Rollback.** `Provider.reserveFor` is the single place the bound is computed.

## D-021 — What happens to money when nobody knows what happened to a request (2026-11-25)

- **Problem.** "Unknown outcomes retain conservative reservation; no duplicate dispatch on retry without
  explicit accounting."
- **Decision.** A call ends in exactly one of: *settled* at the provider-reported cost; *released* because the
  provider answered with a definite error (documented as not billed); or *unknown*. Unknown covers a timeout, a
  lost connection, an abort, a 408 / 499 / 504, a usage report that cannot be priced, and a reservation whose
  process died before recording any outcome (found and marked on the next step). An unknown reservation stays
  held against every ceiling, is never re-sent and is never released by the application: the owner checks the
  provider's usage page and either counts it as spent or declares it unbilled. A second attempt is made only
  after a definite, unbilled failure that may clear (429 rate limit, 5xx, 529), after a pause, under a new
  reservation id. The SDK's own retries are off.
- **Departure from the documented billing rule.** The provider's help pages say failed requests are not
  charged. 408, 499 and 504 are held anyway: nothing proves the work was not done.
- **Evidence.** `ledger.test.ts`, `runs.test.ts` (unknown held and never re-sent; orphan found on resume; retry
  ids `:1` released and `:2` settled), `anthropic.test.ts` (classification table; real SDK against canned HTTP).
- **Cost / risks.** Held money can strand a run below its cap until the owner reconciles.
- **Rollback.** `classifyError` in `src/server/anthropic.ts`.

## D-022 — Model-driven minds inside the engine: who they are, what they keep, what they are told back (2026-11-25)

- **Problem.** D-016 fixed the contract for outside minds but left three things to the host: which people are
  outside minds, what a model remembers between calls, and how it learns that a request was refused.
- **Decision.**
  1. `externalShare` (config, permille): who is decided for from outside is drawn per person by seed on its own
     random key, so the same people are model-driven in every arm that shares a seed. Snapshot schema 4.
  2. Between decisions, and when a decision is missing or refused, such a person acts on the *reflex* layer,
     labelled `fallback`. The planner is deliberately not the fallback: with it, strategy could not be
     attributed to the model.
  3. A note to oneself (at most 200 characters, shown back to that mind only, no effect on the world).
  4. Refusal feedback: what the world refused of the mind's own last decision, with the engine's reason code
     and, for charters and motions, the validator's diagnostic. The reflex layer's own mishaps are not reported.
  5. Every submitted decision is recorded, including one of which nothing was accepted (it changes no body,
     belief or plan — asserted — but is on the ledger and tells the mind why).
  6. A replayed decision keeps the author it was recorded with, so that what a replayed mind founds is
     attributed exactly as in the original run. (Before this change a replayed mock run would have labelled its
     agreements `llm`; found while writing the replay tests.)
- **Evidence.** `cognition.test.ts`, `run.test.ts` (replay through the provider interface reproduces digests and
  origins), pinned baseline digests unchanged. Affordance registry 2026.11-g lists items 2–4 as designer-supplied.
- **Cost / risks.** The note is memory the engine does not curate. Feedback means the engine explains its rules,
  on demand, to model-driven minds only; baseline minds neither need nor get that.
- **Rollback.** `externalShare: 0` gives exactly the previous worlds (digests asserted equal).

## D-023 — Rationing deliberation: three schedulers, one fairness rule (2026-11-25)

- **Problem.** Phase 08: sparse cognition, three activation policies compared on the same seeds, fairness,
  activation reasons, no omniscient coordination.
- **Decision.** `src/providers/schedule.ts`. `round_robin` (everyone in turn), `event` (only minds something has
  happened to: plan finished, refusal, spoken to, asked to decide, new face, a promise falling due, a need
  slipping), `voi` (a weighted sum of the same signals plus waiting time, above a threshold). All three read
  only what belongs to the mind in question — its body, plan, inbox, known agreements — so that being asked to
  think carries no hidden information. All three share the fairness rule: a per-person daily cap, and anyone
  passed over for a set number of epochs goes to the front. Answers are obtained in parallel from one snapshot
  and offered to the world in agent-id order, each validated against the world as it then is.
- **Evidence (development seeds 1–4, mock minds; not findings).** `evidence/phase-08/schedulers.txt`. With 8
  slots per six-hour epoch for 50 people: 153–179 calls in six days, Gini of calls 0.15–0.19, nobody never
  asked, and **only 7–8% of people's time spent on a plan of their own** — the rest is reflex. With slots for
  everyone and a cap of three a day: 16% (voi), 32% (event), 37% (round-robin).
- **What follows.** A mind consulted about once a day is, most of the time, a reflex agent. A pilot that wants
  to see what a model *does* should give few people frequent consultation rather than many people rare
  consultation; mock plans are short (one or two actions) and a model may fill its six, so the real figure has
  to be measured, not assumed. This belongs in the study design (phase 14) as a manipulation check.
- **Not done.** Small-batch multi-agent calls (several minds in one context) are not implemented: the prompt
  program allows them only as a labelled experimental treatment, and one mind per context is the main treatment.
  The Message Batches API is not used: decisions within a run depend on each other's consequences.
- **Rollback.** `scheduler.kind` per run.

## D-024 — Prompt p1: one rules text, one page, in plain text (2026-11-25)

- **Problem.** S01 asks for versioned, tested templates with no institutional priming, speech marked untrusted,
  and minimal versus richer context as separate treatments.
- **Decision.** `src/providers/prompt.ts`, published verbatim in `docs/PROMPTS.md` (generated; CI fails if it is
  stale). (1) The rules text is identical for every person and call in a run and names nobody, so it can be
  cached and so that no mind is told something another is not. (2) The page is rendered from one `Observation`
  as lines of text rather than JSON (about 3 KB instead of 4–5 KB), with every id a mind may use on it. (3)
  Other people's words — speech, charter names, stated purposes — are stripped of control and
  direction-override characters, bounded, and written as one quoted string after a fixed label. (4) Context is
  `rich` or `minimal`; the difference is exactly temperament, skills, the record of others and memories
  (asserted). (5) The page says nothing about the calendar: like baseline minds, a model knows of cold only
  what its own days have told it. (6) Memories of the form "found N at place P" are left off the page: the
  place is already listed as known.
- **Departures from S01's context list.** Action costs in ticks are not listed per action (materials for every
  recipe and structure are). "Token budget" is stated as limits: six actions, a 200-character note,
  160-character speech.
- **Evidence.** `prompt.test.ts`: a lexicon test over every variant of the rules text for institution nouns and
  for advice; a world without the agreement affordance is told nothing about agreements; hostile-speech
  fixtures cannot add a line, a heading or an action to the page; a mind that obeys every hostile instruction
  still has each forbidden act refused and recorded, with the conservation audit clean.
- **Not verified.** How a real model behaves under this prompt, including whether it resists the fixtures. The
  tests prove that obeying them achieves nothing, not that a model will not try.
- **Rollback.** `PROMPT_VERSION`; recordings keep the version they were made with.

## D-025 — One owner, no accounts; spending is authorized in words (2026-11-25)

- **Problem.** Phase 07: owner-authenticated live endpoints, CSRF and origin checks, rate limits, a kill switch,
  no user-supplied API proxy — without adding a billable identity service.
- **Alternatives.** An authentication provider (new dependency, new billing surface); platform deployment
  protection as the only gate (not portable, and no defence against cross-site requests once signed in).
- **Decision.** `src/server/auth.ts`, `http.ts`, `api.ts`. The owner's passphrase is checked against a scrypt
  hash kept in the server environment (`pnpm owner:hash`). A session is a signed, twelve-hour, HttpOnly,
  SameSite=Strict cookie (`__Host-` prefixed over HTTPS); nothing is stored server-side, and changing
  `AUTH_SECRET` signs everyone out. Every state-changing request must name this site in `Origin`, be
  same-origin by Fetch Metadata where the browser reports it, and carry a token derived from the session.
  Sign-in is limited to five attempts a quarter of an hour per address and forty overall, counted in the
  database. Two actions additionally need a typed phrase: setting the authorized budget ("I authorize this
  spending") and approving a paid run ("I approve this run and its cap"). The kill switch ships **on**, the
  authorization ships at **zero**, and releasing the switch authorizes nothing. Without a database every owner
  endpoint answers 503.
- **Evidence.** `auth.test.ts`, `api.test.ts` (eight write endpoints × six kinds of forged request: none changes
  anything or constructs a provider), `tests/e2e/owner.spec.ts` against the real server.
- **Cost / risks.** No second factor. Whoever has the passphrase can spend up to the authorized amount; the
  budget itself, the kill switch and a provider-side workspace spend limit are the mitigations.
- **Rollback.** `requireOwner` is the single gate; another identity check can replace what is behind it.

## D-026 — Server runs as built: a lease, stored answers, one commit per epoch, recordings anyone can check (2026-11-25)

- **Problem.** D-009 chose client-driven resumable steps; this records what was built and what differs.
- **Decision.** `src/server/runs.ts`. A step takes a database lease, rebuilds the world from a gzip snapshot,
  re-plans the epoch (a pure function, so the same plan every time), asks only minds with no stored answer,
  and commits snapshot, tape, digest and scheduler state in one transaction when every mind has a final
  answer — at most once per epoch, guarded by the epoch number and the lease. The lease is handed back by
  clearing it, not by back-dating it (a back-dated lease made two tests fail intermittently: "expired a moment
  ago" depends on clock resolution). A budget refusal pauses the run with the epoch still open; an error no
  retry can fix (bad key, unknown model, spend limit, malformed request) fails it at once. SQL migrations are
  embedded at build time, so the server reads nothing from disk. `DATABASE_SCHEMA` keeps the tables apart in a
  shared database.
- **Recordings.** A visitor may read a *published* run: its configuration, its tape and each epoch's state
  digest — not its cost, trace or outcomes. The browser rebuilds the world from those and checks every epoch's
  digest; a mismatch is shown as such. One mock recording is bundled (`public/recordings/`), labelled MOCK
  wherever it appears.
- **Evidence.** `runs.test.ts` (interruption, resume, kill switch mid-epoch, cap, orphan, two instances racing on
  PostgreSQL with every call paid once); `owner.spec.ts` (a signed-out visitor replays a published run and all
  epochs match).
- **Cost / risks.** A step holds its lease for up to five minutes if its process dies. Snapshots are about
  160 KB compressed at 50 people and are rewritten every epoch.
- **Rollback.** `stepRun` is a plain function; a workflow runner could call it unchanged.


## D-027 — People hidden by the scenery show as a faint shape (2026-11-25)

- **Problem.** The art bible says fifty citizens must be countable at the vista. Screenshots in phase 11 showed
  they were not: anyone working in a wood stood under a canopy as tall as themselves, and a builder behind a
  shelter was invisible from most angles (`evidence/phase-11/cycles/2-woodcutter-hidden.jpg`).
- **Original proposal.** None: the prompts ask for "unobstructed labels" and readable silhouettes.
- **Alternatives.** (a) Stand people outside the wood: tried first; crowns are wider than a tile, so it only
  helped at the edges. (b) Cut away foliage above a selected citizen: helps one person, not fifty. (c) Dots
  drawn on top of everything: robust, but they turn the diorama into a map. (d) Silhouettes: draw each
  citizen's body and head again, faintly, only where something stands in front of them.
- **Evidence.** A first version used a depth test alone and smeared over visible people wherever an arm, belt
  or hat overlapped the body (`3-silhouette-smear.jpg`). The version kept adds a stencil mark written by every
  drawn part of every citizen, so the faint shape appears only where no citizen's own surface shows
  (`4-silhouette-clean.jpg`).
- **Decision.** (d), in ember at 13% opacity from afar rising to 33% close in, so that it hints at the vista
  and identifies at close range. The stencil buffer is enabled on the renderer and on the post chain's target.
- **Affected tests.** None assert pixels. `play.spec.ts` and `observer.spec.ts` exercise the path on every run.
- **Cost / risks.** Two more draw calls and a stencil attachment. Verified only on software rendering; a real
  GPU could differ (MSAA with stencil is standard, but untested here). People hidden by *other people* are not
  shown, by design.
- **Rollback.** Remove the two ghost meshes in `src/render/citizens.ts`; nothing else depends on them.

## D-028 — Sound is synthesized, follows state, and is silent until asked for (2026-11-25)

- **Problem.** Phases 11 and 12 ask for original or licensed ambient sound, meaningful cues and no autoplay.
- **Alternatives.** Licensed recordings (provenance to audit, megabytes to ship, loops that say nothing about
  the world) or synthesis in the browser.
- **Decision.** `src/audio/soundscape.ts`: wind, surf, rain, thunder, birds, crickets, fire, a quiet pad and
  seven cue tones, all from oscillators and one noise buffer. What is heard is read from the frame and the
  camera — weather, daylight, season, a lit fire near the point looked at, whether time is running. No audio
  context exists until the visitor turns sound on with a click or a key; a returning visitor's preference is
  honoured at their first gesture, never before one. Levels are four sliders in the menu.
- **Evidence.** `observer.spec.ts`: level is exactly 0 before the switch, above 0.0005 RMS after it with the
  world running, below 0.0002 with the overall slider at zero.
- **Cost / risks.** Nobody has *listened* to it: this environment has no audio output, so its character and
  balance are unjudged. The test shows that signal is produced and controlled, not that it sounds good.
- **Rollback.** The controller's `sound` member is the only caller.

## D-029 — What a citizen knows is shown by washing out what they have not seen (2026-11-25)

- **Problem.** Phase 12: "see what they know vs what the observer knows". The inspector listed beliefs; the
  world showed nothing.
- **Alternatives.** A depth-reading post effect (needs a depth texture the multisampled chain does not have); a
  translucent sheet over unknown ground (leaves trees and huts in full colour above it); or a per-material
  shader patch.
- **Decision.** `src/render/overlays.ts`. One texel per tile says whether the selected citizen has ever seen it;
  terrain, flora, structures and both water shaders fade toward a pale parchment tone where it is zero. People
  are left in colour: they are the observer's knowledge. The same toggle dims the atlas. A second view draws an
  arc to each person the citizen has dealt with, warm for trust and cool for distrust.
- **Evidence.** `evidence/phase-11/shots/knowledge.jpg`; `observer.spec.ts` (toggles, and a legend that states how
  many of the island's 4,096 tiles the citizen knows).
- **Cost / risks.** One texture read in five materials. Belief *errors* (a bush believed full that is bare) are
  still only in the inspector's list.
- **Rollback.** `buildKnowledge`/`veil` are optional arguments of the four builders.

## D-030 — A field journal of things witnessed, instead of objectives (2026-11-25)

- **Problem.** Phase 12 asks for "optional challenge objectives, meaningful dilemmas, unlock knowledge through
  observation not grind". An objective such as "have them found a council by day 20" would reward the player
  for steering toward a designer's picture of civilization — the thing this project exists not to script.
- **Decision.** `src/ui/game/journal.ts`: twenty-one questions an observer might bring ("Will anyone give
  something away?", "Will a rule be broken, and seen to be?"). Each is answered only by the first engine-logged
  event of that kind in this world, with the Chronicle's own sentence, the day and the place. Nothing is
  scored, nothing is told to the citizens, and a question can stay open for good. The dilemmas remain the
  interventions, whose consequences are never forecast.
- **Affected tests.** `observer.spec.ts` (pages appear from play; seen + open = 21).
- **Cost / risks.** Less of a "game" for players who want goals; that gap is recorded for the human playtest
  that has not happened. A page says that something occurred, never what it proves.
- **Rollback.** A panel and a list; remove both.

## D-031 — Agreements leave a mark in the world only once ratified (2026-11-25)

- **Problem.** Phase 11: "represent new institutions visually through physical artifacts only when actual
  events justify them; no automatic epoch unlocks."
- **Decision.** The frame carries a mark for each *ratified* institution: where it was ratified, how many hold
  to it now, which stores it governs, whether it has ended. The renderer sets a post there with one cord per
  member (up to ten), flies a pennant in the institution's colour on the post and beside each governed store,
  and leaves the post leaning, without pennant or cords, when the institution ends. A charter that was only
  proposed draws nothing. The same colour marks the charter in the Charters panel and the atlas.
- **Evidence.** `evidence/phase-11/shots/charter.jpg` (a scripted control charter, labelled as such in the product).
- **Rollback.** `setMarks` in `src/render/structures.ts`.

## D-032 — A path is drawn where the engine says there is one (2026-11-25)

- **Problem.** Worn paths were invisible. Measured traffic never exceeds about 33 footfalls on any tile of the
  reference world in 40 days, and the tint only saturated near 150.
- **Decision.** One mapping, `wearOf`, shared by the ground shader, the grass and the atlas, calibrated to the
  engine's own threshold: at 24 footfalls — where the engine makes a tile cheaper to cross — the ground is
  drawn as a beaten track and the grass is gone; lighter use only dulls and flattens the turf.
- **Evidence.** `scripts`-level measurement recorded in `docs/EVIDENCE.md` (phase 11); `evidence/phase-11/shots/paths.jpg`.
- **Rollback.** Change the constant in `src/render/palette.ts`.

## D-033 — History is moments and lines; nothing is rewritten, and a past is only trusted if re-living it arrives where it left (2026-11-25)

- **Problem.** Phase 13 asks for an append-only ledger, time travel, branches with an identical past, integrity
  checks, compaction and storage limits — in a browser, on phones, with worlds whose full state serializes to a
  megabyte or more.
- **Original proposal.** "Persist append-only event ledger, snapshot hashes … pure replay from snapshot and
  recorded intents … clone a historical state with exact replay or launch new stochastic continuation."
- **Alternatives.** (a) Persist every event and re-derive state by folding the log: the engine's events describe
  what happened, not a complete state transition, so the log alone cannot rebuild a world. (b) Persist a keyframe
  per day in IndexedDB: tens of megabytes per save, written by every autosave. (c) Keep compressed keyframes in
  memory only, and rely on determinism for everything else.
- **Evidence.** The engine is deterministic by construction (D-003): a world is a pure function of its
  configuration, the observer's interventions with their ticks and, for outside minds, the decision tape. Unit
  tests re-run from an earlier snapshot and from tick 0 and compare byte for byte (`history.test.ts`); the worker
  does the same through its message protocol (`sim.worker.test.ts`). A gzip-compressed keyframe of the reference
  world is 15–300 KB.
- **Decision.** (c).
  1. **Moments.** The worker keeps the start and every second morning as gzip keyframes of the world and its
     twin, at most 24 (the start and the latest eight always; the middle thinned to every other one).
  2. **Watch it again** restores a keyframe and re-applies the observer's interventions at the ticks they were
     made; when it reaches the moment it left from, the state digest must equal the one that was left. The banner
     says which; time is live again only after the verdict, and the past cannot be changed while it is re-run.
  3. **Leave from there** forks a new line from a keyframe with the same random numbers, or with new ones; the
     line being left is frozen with its content hash and can be returned to. A line set aside is a compressed
     copy: lines share no mutable state.
  4. **Saves hold no history.** A world opened from a save has only its present in memory; its past is offered
     back by *living it again from the seed* — configuration, interventions, the twin forked where it was forked —
     and is kept only if the result is, digest for digest, the loaded world and the loaded twin. A save whose
     record was edited fails that check and nothing of the false past is kept (tested). A line that took new luck
     cannot be rebuilt (its earlier epoch is not recorded) and says so; a world with outside minds refers to its
     recording.
  5. **Files.** A world leaves the browser as a bundle: the state, its twin, and a manifest (seed, configuration
     and its hash, engine/schema/affordance versions, branch, every intervention with its tick and origin, the
     SHA-256 of the state, minds and prompt versions when there were any). On the way in the state is hashed
     again, the manifest must describe the world it travels with, and the twin must belong to it; anything else is
     refused and the world on screen is untouched. Limit: 96 MB of text.
  6. **Causes.** The Chronicle's "why" follows the engine's own parent links, nearest first, from a log of the
     last 40,000 events. They are recorded causal edges, never inferred ones; the panel says so, and Compare says
     that one pair of worlds is an anecdote.
- **Affected acceptance tests.** S04-6; phase 13 gate.
- **Cost / risks.** Memory: up to 24 keyframes × 2 worlds, a few megabytes. Rebuilding a long world's past takes
  seconds (it is done in 11 ms slices and reports progress). Event history older than the log's cap cannot be
  traced. The middle of a long history thins to four-day steps.
- **Rollback.** `KEY_EVERY`, `MAX_KEYFRAMES` and the `rebuild` message in `src/worker/sim.worker.ts`.

## D-034 — The twin can be looked at, and a recording gets one (2026-11-25)

- **Problem.** "Synchronized camera views, tick alignment … offline and live recorded histories compare." The
  comparison was numbers only: the untouched world existed in the worker but could not be seen, and a recorded
  run of outside minds had nothing to be compared with.
- **Alternatives.** A split screen (two renderers: twice the GPU cost, unusable on a phone); a second window; or
  one renderer that can be pointed at either world.
- **Decision.** One renderer, one camera, a switch (button, `X`, and a button in Compare). Both worlds are stepped
  on the same ticks, so flipping changes only what differs. While the twin is on screen a banner says so, the
  Chronicle and journal keep following the world being lived (the twin's frames carry no events), nothing can be
  done to the twin, and the inspector shows the same person as they are in the other world. A **recording**
  whose people were decided for from outside gets a twin made from the same configuration with `externalShare`
  0: same seed, same land, same people, same weather, the engine's planner deciding instead. Compare names the
  pair for what it is ("the recording" / "built-in minds") and repeats that one pair is an anecdote. The frame now
  carries the fork tick, which fixed a wrong "Forked on day 1" after loading a forked save (the day had been
  inferred from list lengths).
- **Evidence.** `sim.worker.test.ts` (twin view, recording twin), `tests/e2e/history.spec.ts`,
  `evidence/phase-13/`.
- **Affected acceptance tests.** S04-6; phase 13 gate ("offline and live recorded histories compare" is proven
  with a mock recording only: no live recording exists, because no spend is authorized).
- **Cost / risks.** Replaying a recording now steps two worlds. The twin of a recording differs by who decides,
  which is a bigger difference than one intervention; the panel's wording carries that.
- **Rollback.** The `view` message and the `own` world in the `replay` handler.

## D-035 — A clock for the planner, so that cadence is a treatment (2026-11-25)

- **Problem.** The first pilot of H5 returned ratios of exactly 1: `cadence` was read only by outside minds, so
  the registered treatment never reached the planner baseline.
- **Alternatives.** Make `cadence` bind for the planner (changes the reference baseline every other study and the
  ecology tuning of D-014 rest on); or add a separate setting whose reference value means "no clock".
- **Decision.** `planEvery` (0–960 ticks, default 0 = deliberate whenever the plan runs out). With a clock, a
  planner agent is consulted at most once per `planEvery` ticks and acts on reflex in between; the engine counts
  consultations (`metrics.deliberations`). Engine 0.6.0, snapshot schema 5 with a migration, affordances
  2026.11-h. The deviation is logged in the protocol; no holdout seed had been used.
- **Evidence.** `src/engine/mind/clock.test.ts`: off by default; with a clock nobody deliberates twice within
  the interval; a longer interval means fewer deliberations; snapshots and configurations from before the clock
  open as having none and go on exactly as they would have. The pinned reference digests of `sim.test.ts` are
  unchanged by the new setting at its default.
- **Affected acceptance tests.** H5 (S04-9).
- **Cost / risks.** One more knob. The pilot shows the manipulation is weaker than its nominal 4×: people do not
  need a new plan every 12 ticks, so the consultation ratio is about 0.48, not 0.25 (reported; see D-037).
- **Rollback.** Set `planEvery` to 0 everywhere; the migration is one-way but harmless.

## D-036 — The laboratory: paired seeds, intervals before tests, and a runner that will not touch holdout seeds by accident (2026-11-25)

- **Problem.** Phase 14: registered studies with honest uncertainty, reproducible exports, and at least 100 real
  offline runs.
- **Original proposal.** "Experiment wizard, hypotheses, variables, seed sets, run manifests, budget preview,
  power/precision considerations … effect sizes and uncertainty, multiple comparisons warnings and missing-run
  reporting."
- **Decision.**
  1. **Studies are data** (`src/lab/studies.ts`): each registered hypothesis is its conditions (configuration
     overrides only), its measure, and the rule that would falsify it, transcribed from the protocol. The runner,
     the analysis, the page and the in-browser check all read the same registry.
  2. **Design.** Every condition runs on the same seeds, so contrasts are paired by seed (same land, people,
     weather). Estimates are means over seeds with 95% percentile-bootstrap intervals (10,000 resamples, fixed
     analysis seed, so a report is reproducible to the digit); ratios resample pairs. Effect sizes: d_z and
     Cliff's δ. The verdict is the registered rule applied to the interval; p-values are a paired bootstrap test,
     Holm-adjusted across the family, and shown second. Missing cells are listed and never silently dropped.
  3. **Precision before power.** A pilot on development seeds estimates the spread of each paired difference; the
     confirmatory seed count is the number at which the 95% interval is 0.35 of that spread wide on each side,
     capped at 96 (`planFrom`). The plan is written to a file before any holdout seed is used.
  4. **Seed discipline in code.** `pnpm study` refuses seeds 9000–9999 unless `--confirmatory --plan <file>` is
     given, and then runs only the planned batch: exactly the planned number of seeds, the first holdout seeds
     in order (no choosing seeds, no stopping early, no topping up after a look). A bundle is labelled pilot,
     confirmatory or mixed from its seeds, and a pilot's verdict column reads "would read …", never a verdict.
  5. **Reproducible to the hash.** Every run records the SHA-256 of its final state. The bundle carries the
     hashes; `pnpm study --verify N` re-runs a sample; the Laboratory page re-runs any cell in the reader's own
     browser and compares. Checkpointed JSONL, shardable (`--shard i/N`), resumable.
  6. **No wizard for starting studies in the browser, and no hypothesis-suggesting agent.** A 448-run batch is
     minutes of CPU on a desktop and far too long on a phone; studies are run from the command line and *read* in
     the product. An agent that proposes experiments would need a model call, and nothing may be spent. Both are
     recorded as not built rather than faked. Live studies are blocked with phase 17; the cost estimator they
     would use is the one tested in phase 07.
- **Evidence.** `src/lab/stats.test.ts` (hand-computed fixtures for every statistic, coverage of the bootstrap
  interval on simulated data, Holm against a worked example); `src/lab/analyse.test.ts` (each verdict rule on
  synthetic runs, missing cells, seed classes, the sizing rule, the confirmatory guard, and the registry's
  thresholds against the protocol); `src/lab/cost.test.ts`; `evidence/phase-14/`.
- **Affected acceptance tests.** S04-9; phase 14 gate.
- **Cost / risks.** Percentile intervals are slightly narrow at 16 seeds (the pilot's purpose is sizing, not
  inference). A binary outcome (E2 reached) has a coarse paired difference; its interval is wide and is shown.
- **Rollback.** The lab is additive: `src/lab`, `scripts/study.ts`, `/lab`, `public/studies`.

## D-037 — What the pilot showed, and what is not being done about it (2026-11-25)

- **Problem.** The pilot (development seeds 1–16, 224 runs, engine 0.6.0) is unfavourable to parts of the
  design: the scripted charter — the positive control — does not raise survival in *The Long Winter* (−0.058
  [−0.114, 0.000]); H4's blight kills almost nobody in either condition (a ceiling); H3's interval spans zero;
  H5's manipulation check reads 0.48 where the registered text says at most 0.35.
- **Alternatives.** Retune the ecology or the control until the hypotheses pass on development seeds, then run
  the confirmatory batch; or freeze the engine, run what was registered, and report it.
- **Decision.** No test is altered and nothing is tuned toward a result. The confirmatory batch (32 holdout
  seeds per contrast, 448 runs, `evidence/phase-14/pilot/plan.json`) is run once, after the engine is frozen
  (phases 15–16 may still change it), on seeds 9000–9031, and is reported as it comes out — including a failed
  positive control, in which case, as registered, institutional affordances have not been shown to be materially
  useful in this world and no E5 claim can be made. Variants that would be informative (a harsher shock for H4, a
  wider cadence gap for H5) are exploratory and will be labelled so if run.
- **Evidence.** `evidence/phase-14/pilot/report.md`; the protocol's deviation log.
- **Affected acceptance tests.** S04-9 and the scorecard: a product that reports its own null results.
- **Cost / risks.** The headline finding may be "the control failed". That is the honest state of the model.
- **Rollback.** Not applicable.

## D-038 — The top bar is laid out from measurements, and the fork has a place of its own (2026-11-25)

- **Problem.** Since phase 04 the "Forked on day N" badge sat at the end of the status bar, where at 1366 px it
  slid half under the tool buttons and on a phone was cut off by the screen's edge. Every flow test passed: a
  test's click scrolls its target into view, and a half-covered button is still "visible". Adding a second
  control beside it (the twin) made the defect impossible to miss — it could not be clicked.
- **Alternatives.** Shrink everything with one breakpoint; hide all tool labels below a wide-monitor width;
  move the fork to a banner under the bar (a permanent row of chrome on phones).
- **Decision.** The fork and its twin are a pill of their own between the name and the status. The status bar
  never shrinks. Words give way in a fixed order as the window narrows — Compare's label and the season and
  weather's name (below 1600 px), "Twin" (1440), the remaining tool labels (1340), the world's label (1200) —
  and below 1120 px the status takes a row of its own, as on a phone. On the smallest phones the season and
  weather's name go again (380 px), then "Forked on" (360), and History moves to the menu (340). The numbers
  come from measuring the bar in its widest state; `scripts/topbar.mjs` re-measures 25 widths from 2560 to
  320 px and exits non-zero on any overlap, anything off screen or anything spilling out of its bar, and the
  history flow asserts the same at four desktop and three phone widths.
- **Evidence.** `evidence/phase-13/topbar.txt` and `topbar-*.jpg`.
- **Affected acceptance tests.** S04-10; `history.spec.ts`.
- **Cost / risks.** Between 1340 and 1600 px three tools keep their labels and five are icons with tooltips; a
  first-time player on a small laptop sees fewer words. Font scaling by the user is not measured. The script
  measures the bar with whatever the weather happens to be called: on the clean checkout of this commit a
  longer name made the status row 22 px wider than a 390 px screen (the row scrolls; found by the script, not
  by a person). The next commit lets the weather's name give way on phones and measures with the widest text.
- **Rollback.** The media queries under "the top bar on windows that are not wide" in `game.module.css`.


## D-039 — The charter is brought back to the product (2026-11-25)

- **Problem.** The charter was the first document written, before any code. The phase-16 documentation audit
  (`evidence/phase-16/review-documentation.md`) found it still promising things that were never built, or were
  built differently, with no decision saying so. A reader of the charter would have expected a product that
  does not exist in seven places.
- **Original proposal (charter, phase 01).** "dampen or widen how far voices carry"; overlays for "social
  network · resources · knowledge of selected citizen"; "Compare (treated vs control) ─► Debrief"; an inspector
  for "citizen · place · structure · institution · event"; scenario objectives "evaluated only from engine
  state"; a tutorial whose marks appear "when its subject is on screen".
- **Alternatives.** Build all seven before release; or state plainly what exists, why, and what would have to
  be built — and build only what earns its place.
- **Decision.** The charter now describes the product as built, and lists what its first version promised
  that is not there. Item by item:
  1. *Widening how far voices carry* is not built. An intervention can only lower the hearing radius (Hush:
     radius 1 for four days); `hearingRadius` takes the smaller of the configured radius and the hush. A wider
     radius exists only as a starting condition of a registered study (E2 compares radius 2 with 9).
  2. *A resources overlay* is not built. Stock is read from the thing itself in the world, from the
     inspector's place card and from the almanac's charts of wild food and commons health.
  3. *A Debrief after Compare* is not built. Compare is the last step and ends by saying that one pair of
     worlds is an anecdote (D-012).
  4. *Institutions and events as inspector subjects* are not built. The inspector shows a citizen or a place;
     institutions are read in Charters and events in the Chronicle, each of which links back to the world.
  5. *Scenario aims* are text only: stated on each scenario's card, never evaluated, scored or reported. The
     field journal took the place of objectives (D-030), and that decision did not say the aims stayed as text.
  6. *A social-network overlay of the whole society* is not built: ties are drawn for the selected citizen (D-029).
  7. *The tutorial* is five fixed steps in order, each advanced by the player's own act, not marks that appear
     when their subject comes on screen.
- **Evidence.** The audit report; `docs/CHARTER.md` §§ 3, 5, 6, 7 and 9 as rewritten.
- **Affected acceptance tests.** None changes: no test ever asserted these features. `ACCEPTANCE.md` rows that
  quote the charter were checked against the new text.
- **Cost / risks.** The product is narrower than first sketched. Items 2, 5 and 6 are the ones a player is
  most likely to miss; they are listed as candidates for the redesign phase.
- **Rollback.** None needed for a document. Each item can be built later and the charter extended again.

## D-040 — A speaker can tell only what they know; names and payloads are data (engine 0.7.0) (2026-11-25)

- **Problem.** The adversarial review (`evidence/phase-16/review-security.md`) found four ways in which text
  or structure written by a mind could do more than the engine intended:
  1. *(M7)* A speech act could name any place, structure, agreement or offer by its number, and the hearer's
     beliefs were then filled in from the **world's** state of that thing, not from what the speaker believed.
     Numbers are small integers. A model-driven mind could have named places it had never seen and its hearers
     would have learned what was truly there: knowledge nobody in the conversation had.
  2. *(M8)* The names of roles in a charter were free text, and were shown to every member's mind inside the
     engine's own description of the rules, without quotation marks. A sentence written as a role name would
     have read as part of the rules.
  3. *(L4)* `cleanText` relied on Unicode property classes, whose membership changes with the version of
     Unicode a JavaScript engine ships. Line separators and several invisible characters passed through, and
     two engines could have cleaned the same text differently — a determinism risk for anything stored.
  4. *(L5)* An intent written by a model was stored as it arrived. Fields the engine does not know survived
     into the ledger tape and so into published recordings, and a charter block was bounded only by the wire limit.
- **Alternatives.** Trust the prompt to discourage this (not a control); filter in the provider adapter only
  (leaves the engine open to any future source of intents); or enforce in the engine, where every intent passes.
- **Decision.** All four are enforced in the engine:
  1. `say` begins by asking `untold(world, speaker, act)`: a speaker may tell only of a place, structure,
     agreement or offer they know (refusals `unknown_place`, `unknown_structure`, `unknown_charter`,
     `unknown_offer`). A hearer receives the **speaker's belief** — amount and age for a place, the speaker's
     own record for a structure — never the world's truth. The parties to an agreement or an offer always count
     as knowing it, whatever their bounded memory has let go of.
  2. A role name is a plain label: ASCII letters, digits, `-` and `_`, at most 24 characters (`cleanLabel`),
     and it is shown in quotation marks wherever the engine describes a charter. The rules text given to
     model-driven minds says that names, purposes and role names are their authors' words.
  3. `cleanText` lists the code points it removes explicitly, collapses whitespace to single spaces, never
     splits a surrogate pair and is idempotent. A test sweeps every code point against the property classes of
     this runtime (Unicode 17) so that the list cannot silently fall behind.
  4. `plainIntent` rebuilds every intent from the fields the engine knows, and `boundedCopy` bounds what a
     model may attach: depth 12, 6,000 values and keys, 6,000 characters of text, keys from the grammar's own
     vocabulary. (The largest charter the grammar allows was measured at 4,137 values and keys, 3,696
     characters, depth 9.) Anything larger is refused as `too_large`.
- **Evidence.** `institutions.test.ts`, `cognition.test.ts`, `core/text.test.ts`, `core/bounded.test.ts`,
  `providers/wire.test.ts`. The pilot of the registered studies, re-run on engine 0.7.0, ends every one of
  its 224 runs on the same state digest as the 0.6.0 pilot and with the same value of every measure
  (`evidence/phase-16/pilot-compare.txt`; the SHA-256 of the saved text differs, as it must: the text carries
  the versions). The baseline minds never told of what they did not know, so the studies' behaviour is
  unchanged. (The first re-run matched 219: a member whose memory of charters was full had "forgotten" its
  own. Parties now always know their agreements; a test holds it.)
- **Affected acceptance tests.** Engine 0.7.0, snapshot schema 6, affordances 2026.11-i, prompt p2. Recordings
  made on earlier versions are refused by version, as before; the bundled mock recording was re-recorded and
  ends on the same state digest.
- **Cost / risks.** Role names lose spaces and non-ASCII letters. A mind cannot pass on a rumour of a place it
  has only an id for — which is the point. The explicit code-point list has to be extended when Unicode adds
  invisible characters; the sweep test fails on a runtime that knows some the list does not.
- **Rollback.** Not recommended. The gate is one call at the start of `say`.

## D-041 — Two Shores has two shores (2026-11-25)

- **Problem.** The scenario's card and the charter said "stone and clay lie on one shore, timber and most
  food on the other." The engine placed resources by biome alone: both shores had the same ecology, and only
  the strait and its ford existed (audit finding H3: stone 31/35, clay 5/10, trees 193/213 on seed 1).
- **Alternatives.** Change the sentence to match the engine; or make the engine do what the sentence says.
  For the latter: only take resources away from each shore; or move them, keeping the island's total.
- **Evidence gathered first.** `scripts/shores.ts`, development seeds 1–12, baseline minds: of the people who
  began on each shore, the share alive at the end (`evidence/phase-16/two-shores.txt`). Unsplit: 99.7% / 99.3%
  at 40 days, 98.1% / 98.6% at 80. Moving resources, at 800‰: 96.6% / 100.0% and 75.6% / 81.3% (famine in
  three of the twelve worlds, near-total in two of them); at 600‰: 96.9% / 99.0% and 81.7% / 84.9%; at 400‰:
  97.3% / 99.7% and 81.4% / 85.9%. Nearly everyone crosses the ford at some time, at every setting. The first
  version only took resources away; at 800‰ it measured 96.9% / 99.0% at 40 days and 47.5% / 52.5% at 80 — the
  island was a third short of food and both shores starved in their second year. That version was replaced
  and is not in the repository, so those two figures are from the developer's notes and cannot be re-run.
- **Decision.** A configuration setting, `shoreSplit` (permille), 800 in Two Shores and 0 everywhere else.
  One shore, chosen by the seed, has a fifth of its usual trees, two fifths of its berries and roots and 1.8
  times its stone and clay; the other has 1.6 times the berries and roots and a fifth of the stone and clay.
  Reeds and fishing water are the same on both. What one shore loses in food and stone the other gains, so the
  island holds about what an undivided one would. With the setting at 0, placement is byte-for-byte what it
  was before (asserted against the node count of the previous commit).
- **Affected acceptance tests.** `world.test.ts` (Two Shores). Snapshot schema 6 migrates older saves with
  `shoreSplit: 0`, so a saved Two Shores world keeps the island it was made with.
- **Cost / risks.** Two Shores is now a hard scenario for the baseline minds in its second year: about a
  fifth of the people are lost by day 80 on development seeds, most of them in three worlds that starve. That
  is a property of the scenario, stated here, and not a finding. None of the registered studies uses it.
- **Rollback.** `SHORE_SPLIT = 0` in `src/engine/model/config.ts`, and the old sentence would then be false again.

## D-042 — Hardening after the adversarial review (2026-11-25)

- **Problem.** Before any live call is ever authorized, the server was reviewed by an independent agent
  briefed to attack it (`evidence/phase-16/review-security.md`). It found no way for an unauthenticated or
  cross-site request to reach the provider or the budget, and no request sent without a reservation; and it
  found eight medium and sixteen low weaknesses at the edges. Those bearing on the engine are D-040, and the
  file import is D-043. The rest are here.
- **Decision.** In the order of the review:
  - *M1, who may raise the authorization.* A deployment has a ceiling, `BUDGET_CEILING_USD`, set in the
    server's environment (default 0, at most 10,000). The owner's console can authorize up to it and no
    further; raising it takes access to the deployment, not the passphrase. The console shows it.
  - *M2, the smoke test.* The vitest-driven live test is deleted. `pnpm live:smoke` is a script that prints
    what is configured and the words that would authorize the next run; with `-- --run` and those words it
    makes at most three requests under a cap of at most $2. Each run has a number and its words work once;
    its ledger is a schema that is never dropped. **It has never been run with a key.**
  - *M3, locking the owner out.* Sign-in attempts are counted per client (5 per quarter hour) before the
    shared count (40), and a browser the owner has signed in on carries a signed device cookie with a count
    of its own (10), so strangers cannot use up the owner's attempts.
  - *M4, strangers writing to the database.* Public reads are limited in memory and touch no table. Client
    addresses are believed only from the platform's own header on Vercel (or with `TRUST_FORWARDED_FOR`), and
    IPv6 addresses are counted by /64.
  - *M5, a run wedged by an interrupted call.* Every state a reservation can be left in is recovered when the
    run is next stepped (`interrupted`, `answer_lost`, `released_without_record`); money and the record of
    the call are written in one transaction (`Ledger.conclude`).
  - *M6, a 5xx is not proof.* A failure is "rejected, not billed" only if it carries the provider's error
    envelope and a request id; anything else is "unknown" and holds its reservation until reconciled.
  - *L1, overage.* What a call costs beyond its reservation counts against the total, the run and the day. A
    settlement that arrives after its reservation was released is recorded as overage, turns the kill switch
    on with a reason of its own, and that switch is released only with the words "I have checked what the
    provider charged".
  - *L2, the SDK's environment.* The adapter passes a `fetch` that will only POST to
    `https://api.anthropic.com/v1/messages` with an allow-listed set of headers and no redirects; logging is
    off; and live mode refuses to start while `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
    `ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_LOG` or `ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE` is set.
    Reading the installed SDK for this turned up something the review had not: version 1.14.0 enables
    OpenTelemetry tracing and trace propagation by default. Both are switched off (`openTelemetry: false`).
  - *L3.* Live mode requires PostgreSQL everywhere, not only in production.
  - *L6–L8.* Late settlements are recorded (above); three answers in a row that were paid for and unusable
    pause the run (`unusable_answers`); a call has a hard deadline inside its lease, and a step's lease (280 s)
    outlasts its budget (150 s). An answer from a model other than the one asked for is fatal (`wrong_model`).
  - *L9–L10.* A visitor is given a named subset of a published run's manifest (no cap, no cost); `from` is
    validated; every handler is wrapped so that an unexpected error is a plain 500 with nothing in it.
  - *L11–L12.* Signing out ends every session (an epoch in the database, checked on each request); new
    passphrase hashes use scrypt with N = 2^17; forwarding headers are trusted as in M4.
  - *L14.* Reconciliation, a run's status and publication write their audit row in the same transaction.
  - *L15.* The secret scan knows every kind of key and token the provider issues, excuses no line, treats a
    database host as nobody's only if the name is the whole host (whichever host the address means), scans
    untracked files that are not ignored, fails on archives and oversized files instead of skipping them, and
    has a history mode (`pnpm scan:history`, in CI) that reads every line any commit has added.
  - *L16, one origin for the game and the console.* Accepted, with two mitigations. The source may contain no
    way of turning a string into markup or code: `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`,
    `document.write`, `eval`, `new Function`, string timers and `javascript:` URLs are lint errors under `src/`.
    And what a script running in the owner's browser could do is bounded by the deployment's ceiling (M1); it
    could not read the key. A separate host for the console is the stronger fix and is left to the owner
    (`docs/SECURITY.md`, "One origin").
  - *Information items.* Database connections have statement, lock and idle-in-transaction timeouts, and a
    broken connection is destroyed rather than returned; `pnpm db:migrate` honours `DATABASE_SCHEMA`. Left as
    they are and documented: HSTS is sent only on Vercel; CI actions are pinned by tag; `window.__tr` is a
    read-only handle shipped in production; members see their agreement's live rules whatever the distance.
- **Evidence.** `src/server/*.test.ts`, `tests/unit/scans.test.ts`, `tests/e2e/owner.spec.ts` (the ceiling is
  shown and enforced; signing out ends a copied session); migration `0002_hardening.sql`.
- **Affected acceptance tests.** Deliberate changes of expected behaviour, listed in `docs/QA_REPORT.md`:
  a settlement after a release is now `late`, not `already`; the failure table requires the provider's
  envelope; sign-in sets two cookies; the scan's `scan:allow` exception is gone.
- **Cost / risks.** One more setting the owner must make before a live run. A failure the provider answers
  without its envelope (a proxy's error page) holds its reservation until the owner reconciles it by hand.
  None of the live path has met the real service: every provider test uses canned responses.
- **Rollback.** Each item is independent; the migration only adds columns, an index and one table.

## D-043 — An opened file is checked, tried and labelled (2026-11-25)

- **Problem.** *(Review L13.)* Opening a world file checked its envelope and its hash, not its contents. A
  file could carry a well-formed snapshot of an impossible world — an agent standing in the sea, an inventory
  of negative berries, a pointer past the end of a list — and the engine would run it, fail somewhere inside a
  tick, and leave the page with a dead world and no explanation. A file could also claim a past it never had.
- **Decision.** Four layers. `validateState` checks every field of a restored world for type and range,
  including every stored charter against the grammar, and `restoreWorld` refuses with the path of the first
  thing wrong. A bundle's goods must add up (`auditGoods`) for the world and for its twin. The worker then
  runs a copy of the opened world forward for a short trial and refuses the file if that throws. And any
  error inside a tick stops the world behind a notice with one way on, instead of leaving a frozen page; a
  stopped world is not autosaved. Separately, History says where a past came from: `made` here, `opened` from
  a file (whole, unchecked) or `relived` (re-run from its start and found to arrive where the file says).
- **Evidence.** `save/validate.test.ts` (worlds the engine itself produces are accepted; about forty targeted
  corruptions are each refused at the expected path; and a seeded property test — whatever passes can be lived
  in — 400 cases on every run of the suite and 3,000 in `evidence/phase-16/fuzz-validate.txt`),
  `save/history.test.ts` (a forged bundle), `worker/sim.worker.test.ts` (the trial and the fault notice),
  `tests/e2e/history.spec.ts`.
- **Cost / risks.** About 350 lines that must follow the shape of the state. A field added to the engine
  later and not to the validator is simply not checked, and nothing fails; the guard against that is the
  property test, not the validator. Opening a file costs one extra pass and a trial of half a simulated day.
- **Rollback.** Remove the call in `restoreWorld`; the envelope and hash checks remain.

## D-044 — The confirmatory batch, as it came out (2026-11-25)

- **Problem.** The protocol registered six hypotheses with falsification rules before any data existed, and
  kept seeds 9000–9999 unseen. A pilot on development seeds (D-037) had already suggested that the positive
  control would fail. Running the confirmatory batch risks an unflattering result; not running it leaves the
  laboratory as machinery with nothing through it.
- **Decision.** Run it once, on the engine as frozen (0.7.0), and publish whatever comes. 448 runs of 448:
  holdout seeds 9000–9031, the pilot's plan of 32 seeds, seven contrasts in one Holm family. Every cell was
  then recomputed and matched (`verify.txt`: 16 of 16 sampled cells; the pilot's 12 of 12).
- **Result.** Paired differences with 95% intervals:
  - H1a, cooperation at richness 0.7 against 1.3: 0.0151 [0.0122, 0.0179] — supported.
  - H1b, cooperation at 0.7 against 0.4: 0.0109 [0.0079, 0.0138] — supported.
  - H2, specialization with skills that grow: 0.056 [0.052, 0.060] — supported.
  - H3, reach of agreements at hearing radius 9 against 2: 0.31 [0.06, 0.53] — supported by its registered
    rule (the interval excludes zero); its Holm-adjusted p is 0.0564, which is reported beside it.
  - H4, diversity and survival after a blight: −0.001 [−0.003, 0.000] — **falsified**. Almost nobody died in
    either arm (a ceiling the pilot had shown).
  - H5a, welfare with a slower clock (ratio): 1.056 [1.051, 1.062] — supported.
  - H5b, deliberations with a slower clock (ratio): 0.484 [0.482, 0.486] — **not supported**: the
    manipulation was weaker than the 0.35 the protocol required of it.
  - H6a, the positive control — a charter written by the designers raises survival in The Long Winter:
    −0.009 [−0.054, 0.037] — **falsified**.
  - H6b, agreements found by the agents' own search change survival: 0.021 [−0.026, 0.068] — reported; no
    direction was predicted and the interval includes zero.
  - Not registered, descriptive only: with the agents' own search an agreement was adopted in every run of
    The Long Winter and persisted in 0.88 [0.75, 0.97] of them; the designers' charter was adopted in 0.91 of
    runs and persisted in none.
- **What follows, as registered.** With the positive control failed, institutional affordances have not been
  shown to be materially useful in this world, and no claim that agreements *help* the baseline minds can be
  made from it. H1–H3 and H5a are statements about a designed simulation with baseline (non-language-model)
  minds on one parameterization; they are not findings about people or about language models.
- **Evidence.** `evidence/phase-16/confirmatory/` (every run, the manifest with each run's hash, the report,
  the verification); published at `/lab` from `public/studies/confirmatory/`.
- **Cost / risks.** The holdout seeds 9000–9031 are spent: they cannot be used to confirm anything else.
  Seeds 9032–9999 remain unseen.
- **Rollback.** None. A registered result is not withdrawn; a redesign of the control or of H4's shock would
  be a new registration on new seeds.

## D-045 — The top bar measures itself (supersedes the breakpoints of D-038) (2026-11-25)

- **Problem.** D-038 laid the bar out with media queries computed from its width "in its widest state". That
  state was not the widest: `scripts/topbar.mjs`, taught to write the longest labels the bar can be asked to
  show (a four-digit day, "Cold snap", −18°, five hundred citizens, a fork on a four-digit day), found the
  game's name squeezed at 1600, 1366 and 1180 px, the tools 2 px off the screen at 1120, and the status row
  spilling at every phone width from 430 down to 320. The fixed widths also had to assume the fork pill was
  present, so a world nobody had touched lost words it had room for.
- **Alternatives.** New, wider breakpoints for the longest labels (correct, and wasteful: at 1366 px every
  tool would lose its word to make room for a pill that is usually absent); a `:has()` rule for the pill
  (two sets of numbers to keep true); or measuring.
- **Decision.** `src/ui/game/fit.ts` tries the bar in eight states, most generous first, and sets the first
  in which nothing is squeezed, clipped or off the screen; if none fits, the status takes a row of its own
  (and the tools keep their words there if they still fit beside the name and the fork pill).
  Words give way in the order: Compare's label and the season and weather's name; "Twin"; "Forked on"; the
  world's label; then the tools' words — after which the world's label and "Forked on" come back if there is
  room. A status row as wide as the window that is still too full (a narrow phone late in a long game) gives
  up its optional words, then its spacing, then the size of the founding population. It is measured again
  when the window changes size and when what the bar holds changes width — numbers are tabular, so that is
  when a count of characters changes — not on every frame. Below 880 px the stylesheet lays out the rows as
  before and only the status row is measured.
- **Evidence.** `evidence/phase-15/topbar.txt` and `topbar-*.jpg`: 25 widths from 2560 to 320 px, three
  times — untouched, forked, and with the longest labels. `fit.test.ts` for the order of the states.
- **Affected acceptance tests.** S04-10; `history.spec.ts` (no overlap at four desktop and three phone
  widths). Tests no longer treat the world label's visibility as the sign that a world has loaded.
- **Cost / risks.** Layout is read up to nine times when the bar's contents change width, which is rare. The
  states are words in a `data-hide` attribute that the stylesheet must know (a test checks the vocabulary).
  Font scaling by the user is handled by the measuring, but has not been looked at by a person.
- **Rollback.** Remove the hook; the attribute rules do nothing without it and every word shows.

## D-046 — Profile first: what the long benchmark found, and the one change made to the frozen engine (2026-11-25)

- **Problem.** Phase 15 asks for profiling before optimizing. The benchmark inherited from phase 03 runs five
  simulated days and showed nothing wrong: 3,244 ticks a second at 50 people, 234 at 500. Run for twenty days
  it showed something else. At 250 people throughput fell to 41 ticks a second, with one tick in twenty taking
  130 ms or more; at 500 people to 13, with one in twenty taking 280 ms
  (`evidence/phase-15/bench-planner-before-memo.txt`).
- **Evidence.** The profile put 75% of the whole process in `findPath`, all of it called from `approach`
  (`evidence/phase-15/profile-planner-250-before-memo.txt`). Counting refusals day by day explained it: from
  about the fifteenth day of that crowded world, hungry planner agents ask — every tick — to gather from a
  place that cannot be reached with what they know of the map. On day 20 there were 7,014 such refusals, some
  agents making 96 in a day. Each asking searched every tile the agent could reach before failing. The
  reference world (50 people on a 64 × 64 island, seed 1) has no such refusal in forty days, and a sample of 42
  cells of the registered studies has 110 in all, in five cells: an occasional refused step, never the loop
  (`evidence/phase-15/unreachable-refusals.txt`).
- **Alternatives.** (a) Teach the planner to remember what it could not reach. That is the right repair of the
  *behaviour* — and it is a change of behaviour, so a new engine version, after the confirmatory batch was run
  on this one. (b) A faster search (jump points, a hierarchy of regions): hard to make break ties exactly as
  the present one does. (c) Remember failed searches, exactly.
- **Decision.** (c), and nothing else. `findPath` answers "no route" without searching only when the agent,
  the tile it starts from, the goal, the nearness asked and the agent's entire memory of what it has seen are
  bit for bit those of an earlier search that exhausted every tile it could reach. A search is a function of
  exactly those and of terrain that never changes, so the answer cannot differ; nothing is inferred beyond
  that (one new tile seen, or one step taken, and the search is made again). What is remembered lives in the
  engine's transient working memory, never in a snapshot. **The engine's behaviour is unchanged and its
  version stays 0.7.0.**
- **Proof that nothing changed.** `sim/pathfind.test.ts`: 720 questions on a divided island — between them
  the agent moves, learns, learns everything and (as no agent in the engine ever does) forgets everything —
  each answered identically by a copy of the world that has never searched; and a crowded island in famine
  arriving at the same state digest with the memory and with it thrown away before every tick. Four worlds, lived with the memory
  and with it switched off, ending on the same SHA-256 of their whole saved state, with the same deaths and
  the same refusals (`evidence/phase-15/pathfind-memo.txt`). And the
  registered studies: 48 cells of the confirmatory batch and 24 of the pilot, re-run from scratch on the
  changed engine, each reproducing its published hash (`evidence/phase-16/*/verify.txt`).
- **Result.** Twenty days, planner minds, three runs: 250 people 240–278 ticks a second (from 41), the slow
  tick in twenty 8–10 ms (from 130); 500 people 97–102 (from 13), 20–23 ms (from 280). The reference world is
  as it was within the noise of this machine (1,070–1,579 over twenty days).
- **What was not changed, and should be known.** The behaviour itself. In a crowded world that is starving,
  baseline planner agents still ask for the unreachable every tick, and some die doing it. That is a defect of
  the hand-written baseline, found by this benchmark, present in the engine the studies ran on (their worlds
  are not crowded, and show the refusal now and then but not the loop), and left for the redesign phase:
  repairing it means engine 0.8.0.
- **Also decided in this phase, and measured in `docs/PERFORMANCE.md`.** Saves are stored compressed (the
  text of a 50-person world is 1,162 KiB and 112 KiB as stored; the hash is of the text either way). The
  autosave slot has one owner among a browser's tabs. A hidden tab stops time and saves. A renderer that
  cannot keep up lowers its resolution, then — only if the preset was automatic — steps down once. No WASM:
  after the memory, the largest single cost is perception at about a quarter of the process, spread over
  loops on typed arrays, and the reference world runs at eight times what the fastest speed asks.
- **Cost / risks.** One copy of an agent's sight memory (at most 2 KB on the largest island) for each agent
  that has ever failed a search, and a byte-for-byte comparison when it asks again. If terrain ever became
  changeable, the memory would have to be keyed on that too: a comment in `findPath` says so.
- **Rollback.** Two calls in `findPath` (`knownNoRoute`, `rememberNoRoute`).

## D-047 — The database's limits travel with each transaction, and a lost connection is survived (2026-11-25)

- **Problem.** Two things, found while preparing to deploy and while writing the test the QA report said did
  not exist ("no test waits for a timeout").
  1. D-042 gave every database connection a statement, a lock and an idle-in-transaction limit by sending them
     when the connection is made (the driver's `options` startup parameter), and put a suite's tables in a
     schema the same way. The connection string a Vercel Marketplace database injects as `DATABASE_URL` — the
     name this application reads — points at a transaction pooler. The provider documents that its pooler
     "allows only startup parameters it can keep track of", names five, and has an error for the rest
     (`docs/research/vercel-platform.md` §12). Run here against the same pooler in the same mode (PgBouncer
     1.22.0, transaction mode, default strictness), the application's former settings get exactly that error:
     `FATAL: unsupported startup parameter in options: statement_timeout`. The ledger could not have been
     reached on the first hosted database it met. That is failing closed, and it is still a deployment that
     does not work.
  2. A connection lost while a transaction held it — the server ending an idle transaction, a database
     restarting, a network drop — is announced by the driver as an `error` event on that connection. The pool
     listens for it only while a connection is idle. An `error` event nobody listens for ends a Node process:
     every request in flight on that instance, not just the one whose connection dropped.
- **Original proposal.** D-042's information item: "Database connections have statement, lock and
  idle-in-transaction timeouts", by construction, untested.
- **Alternatives.** (a) Use the direct connection string where the provider offers one
  (`DATABASE_URL_UNPOOLED`): the code stays as it was, and the smallest hosted database has 105 usable
  connections to share among every function instance, ten a pool. (b) Set the limits on the role
  (`ALTER ROLE … SET`): changes a database the application may share, and needs rights it should not want.
  (c) Open every transaction with `SET LOCAL`. (d) The platform's `attachDatabasePool`: about idle connections
  when a function is suspended, not about either problem; a new dependency.
- **Decision.** (c). Every transaction opens with one statement — `BEGIN`, the three limits and the schema, each
  `SET LOCAL` — and a statement on its own is a transaction of one, so nothing is ever asked of the database
  outside those limits and nothing is left on a connection when a transaction ends. The same code path runs
  through a pooler and straight to a server; there is no switch to forget. Every held connection has a
  listener for its `error` event; the loss then fails whatever is asked of the connection next, the
  transaction's caller sees the failure, and the connection is destroyed rather than returned. If the opening
  statement itself fails, the connection is destroyed and one more is tried: a pooled connection can have died
  while a function was suspended, and nothing has been asked of the database at that point. **Nothing after the
  opening is ever sent twice** — a statement that may have run is not repeated; the ledger's own rules decide
  what an unknown outcome means (D-020).
- **Evidence.** `src/server/db.test.ts`, ten tests. Six read what is actually sent, with a stand-in for the
  server that speaks enough of the protocol: the first message of a connection carries only parameters a
  pooler accepts and no `options`; every transaction opens with exactly the limits and schema; a connection
  dropped at the opening costs one retry; two dropped openings are the caller's error; a connection dropped
  after the opening is not retried and the work is not started again. Four run against PostgreSQL 16: the
  limits and schema are in force for a lone statement and inside a transaction, and the session between
  transactions is exactly an untouched session; a statement past its limit is cancelled (57014) and the
  connection goes on working; a lock not given within its limit is not waited for (55P03) and nothing is
  written; a transaction left idle past its limit is ended by the server, its work undone, and the pool's only
  connection replaced. With the listener removed the same run reports "Connection terminated unexpectedly" as
  unhandled errors and fails.
- **Through a pooler** (`evidence/phase-16/pooler.txt`). With the test database behind PgBouncer in transaction
  mode: all 107 server tests pass, the ten that need a real server among them; the ledger load test balances
  its books with no error and no ceiling exceeded (809 reservations a second against 1,144 straight to the
  server); the production server serves every route and a mock run from start to finish; and the owner's
  browser tests pass on the desktop and phone projects.
- **Cost, measured on this machine.** Straight to a local server, before and after: 1,059 and 1,144
  reservations a second, one reservation p50 25 and 22 ms — no difference beyond noise, as expected where a
  round trip costs a tenth of a millisecond; the public list of recordings p50 1.9 ms both times
  (`evidence/phase-15/load*.txt`, `requests*.txt`). Through the local pooler a lone statement's two extra round
  trips show: the list of recordings p50 3.2 ms, the signed-in status p50 8.2 ms (from 4.3). A hosted database
  adds a network to each of those; that has not been measured.
- **What this does not show.** No hosted database has been connected to. The pooler here is the same program
  in the same mode as the provider documents, not the provider's installation of it; `docs/DEPLOYMENT.md` has
  the check to make on the first real one.
- **Affected acceptance tests.** New: `src/server/db.test.ts`. Unchanged and passing: every suite that uses
  PostgreSQL (`ledger.test.ts`, `runs.test.ts`, `api.test.ts`, `smoke.test.ts`), which now run through the new
  path.
- **Cost / risks.** A lone statement is three round trips instead of one (open, statement, commit). On a
  hosted database in the function's region that is of the order of a millisecond or two more per statement;
  the public list of recordings is the only route a stranger can make pay it.
- **Rollback.** `openPostgres` in `src/server/db.ts`: restore the `options` string and `pool.query`. Do not
  roll back the listener.

## D-048 — The site runs on the Node.js the tests ran on (2026-11-25)

- **Problem.** `engines.node` said `>=22.12.0`. Vercel reads that field to choose the runtime, and a range
  like it selects the newest major the platform offers — 26.x on the day its documentation was read
  (`docs/research/vercel-platform.md` §2). Every test, benchmark, study and replay in this repository ran on
  Node 22. The server replays worlds and compares digests; what it runs on should be what was tested.
- **Original proposal.** `>=22.12.0`, from phase 02, when nothing was being deployed.
- **Alternatives.** Leave the range and meet an untested runtime in production. Test on 26 as well and keep
  the range: right, later; that version is not in the development container or in CI.
- **Decision.** `"node": "22.x"`. The platform then deploys the latest 22.x; CI already pins 22.
- **Evidence.** The platform's documentation, as quoted in the research file; `.github/workflows/ci.yml`
  (`node-version: 22`); `evidence/*` (Node v22.23.5 in every recorded environment).
- **Affected acceptance tests.** None.
- **Cost / risks.** A developer on another major gets a warning from the package manager, not an error
  (nothing here sets `engine-strict`). Node 22 will leave the platform's list one day: moving on means running
  `pnpm check`, `pnpm e2e` and `pnpm study -- --verify` on the new major, then changing this one line.
- **Rollback.** That line.

## D-049 — The aim on a scenario's card is counted, here and in the untouched twin (2026-11-25)

- **Problem.** Phase 20 asks whether the thing is worth watching and whether the observer's choices mean
  anything. Every scenario states an optional aim on its card — and nothing in the product ever said how it
  had gone (D-039 item 5 said so plainly). An observer could change a world and be shown two columns of
  numbers, with no word on the one question the world had been set up to ask. The first charter promised
  aims "evaluated only from engine events"; that promise was withdrawn in D-039 rather than kept.
- **Evidence, before anything was built.** Two of the five aims as first written cannot be met, and two cannot
  be missed (`evidence/phase-20/aims-first-written.txt`; development seeds 1–10, both baseline minds, nobody
  intervening). "Lose no one to cold or hunger before spring" (The Long Winter): between 8 and 38 people are
  lost that way in every world measured. "Keep every commons above its collapse threshold for a year" (Thin
  Commons): some grove or fishing water is below its threshold by the eighth morning in every one of the hundred
  worlds, whatever the scenario — ordinary foraging does it. First Light and Dry Year are met in all twenty
  worlds each.
- **Alternatives.** (a) Leave the aims as text: honest, and the gap stays. (b) Evaluate them as written: two
  verdicts that are always "lost" teach nothing. (c) Objectives about what the citizens should build: rejected
  in D-030 and still rejected — an aim here is about who is alive, never about how. (d) Count what the card
  asks, reword the two that could not be met to ones that can go either way, and show the same count for the
  untouched twin.
- **Decision.** (d).
  - *What is counted* (`src/worker/aims.ts`, a pure reading of the world's state; the engine is untouched and
    its version stays 0.7.0). First Light: four in five of the fifty who began, alive on the first morning of
    the spring after the first winter. The Long Winter: three in five by that morning (was: nobody lost to cold
    or hunger). Thin Commons: four in five at the end of the first year, with the commons' average fullness
    and their emptiest morning shown beside it (was: every commons above its threshold). Dry Year: four in five
    on the morning the scenario's own drought ends. Two Shores: the gap in well-being between those who began
    on each shore, the dead counted as nought — a reading with no day of reckoning and so no verdict.
  - *Three kinds of answer.* Open until the day of reckoning; then met or lost; lost early on the day too many
    have died for it to be met. A verdict once given does not move. Newcomers brought by the observer's hand
    are not among those counted.
  - *From the state alone.* Deaths carry their tick, so a world that was saved, opened from a file or returned
    to in History gives the answer it would have given if watched: no latch, no stored verdict.
  - *The drought is not foretold.* Before it comes the reading says only that it has not come.
  - *Where it is shown.* The Atlas, above the almanac: the card's sentence, where it stands, and the same for
    the untouched twin once the observer has made one. A notice on the morning it is decided. Nothing is
    scored, nothing accumulates, and no citizen is told.
- **Why this does not undo D-030.** D-030 refused objectives that reward steering toward a designer's picture
  of civilization. These five sentences were already on the cards; none says what the citizens should do or
  build; and the reading is the almanac's kind of statement — a count — not a reward.
- **How the reworded aims fall** (`evidence/phase-20/aims-calibration.txt`, same seeds): The Long Winter is met
  in 4 of 10 worlds with planner minds and 5 of 10 with reflex minds; Thin Commons in 4 and 5; First Light and
  Dry Year in all. So two aims are the observer's to lose and two can go either way. Whether the observer's
  hand can *save* a world that would have lost has not been measured.
- **Affected acceptance tests.** New: `src/worker/aims.test.ts` (eleven), three in
  `src/worker/sim.worker.test.ts`; `tests/e2e/observer.spec.ts` (the aim in an untouched world) and
  `tests/e2e/play.spec.ts` (both worlds after an intervention). The charter's table of scenarios is rewritten
  (§5). Unchanged: every engine test, every golden digest and every published study hash — the aims' wording
  lives beside the scenarios in `src/engine/model/config.ts` and is part of no world.
- **Cost / risks.** One reading a morning (a count over fifty people; for Two Shores, one flood fill and, once
  per world, one making of the world as it first was). An aim that is always met is a weak aim: First Light
  and Dry Year are gentle on purpose (D-014), and say so by being met. Counting an aim invites treating it as
  a score; the block says in its heading that it is not one.
- **Rollback.** `src/worker/aims.ts`, the `aim` messages in the protocol and the block in `Atlas.tsx`; the
  cards' sentences in `config.ts`.


## D-050 — The world is lived at its own pace; the picture is sent at the page's (2026-11-25)

- **Problem.** A browser test failed once in CI, after phase 20 was written up (run 45690303999, the desktop
  job, commit `55dc9db`; the next commit's run was green). After playing at the fastest speed and pausing, the
  two-tabs test asked for "an autosave of seed 7 from one of the last second mornings before day 9" and waited
  thirty seconds for something that could no longer become true. Followed back to its cause, it was two things:
  one in the test, one in the product.
  - *The test asked for more than the game promises.* The page asks for the autosave when it sees that a
    second morning has come; the worker keeps the world as it is when the request reaches it. At 64× a day
    lasts three quarters of a second. On a machine where the page is shown the world that much late, the world
    that is kept is the next day's — a newer save, and a good one — and the test demanded an even day. The log
    of the failed run does not say what the slot held (the assertion printed only that a predicate was false;
    that is fixed too). What is established is the mechanism, reproduced on the build of the commit after it
    (the assertion and the autosave were the same in both) with the page slowed ten times: the old assertion
    fails in five runs of ten, each time for a save from the very day the world stopped on
    (`evidence/after-20/old-assertion.txt`).
  - *A page slower than its world fell behind it without limit.* The worker sent a frame thirty times a second
    whether or not the page had dealt with the last one. A page that needs longer than a thirtieth of a second
    for each never catches up: with the page slowed twenty times and the world at 64×, the picture ran on for
    2,079–3,359 ticks after pause was pressed, "paused" was shown 31–39 seconds later, and the page's own
    timers fired 17–27 seconds late — which is what a click would have waited too
    (`evidence/after-20/trail-before.md`). Slowed ten times or less, the page kept up: the queue either stays
    short or grows for as long as time runs. Nothing in the suite had shown it, because nothing slowed a page
    that much.
- **Original proposal.** Phase 02: the worker owns the loop and posts a frame every turn of it. Phase 15 made
  the worker keep the pace it is asked for (ticks owed are made up, not dropped); it did not ask what the page
  does with what it is sent.
- **Alternatives.** (a) Correct the test and leave the product: the test would pass, and a slow phone at 64×
  would still be shown a world a minute old. (b) Have the page throw away frames that are stale: it still has
  to receive every one, and receiving them is the cost. (c) Have the page ask for each frame from its drawing
  loop: the flow of frames would then stop whenever the browser stops calling that loop (a hidden tab), and
  the page learns that time has stopped, or that a world has arrived, from frames. (d) The page answers every
  frame; the worker sends the next only when the last has been answered, and at once if one came due in the
  meantime.
- **Decision.** (d), and with it three smaller things.
  - *One frame on its way at a time* (`src/worker/sim.worker.ts`: `untaken`, `frameOwed`, `sendFrame`; the
    `taken` message in `src/worker/protocol.ts`; `src/store/simClient.ts` answers in a `finally`, whatever
    becomes of the frame). The world is lived at the pace asked whatever the page does. What a frame carries
    since the last one — the Chronicle's events, the lists sent when they change — is gathered when a frame is
    built, so a frame that was not sent loses nothing: the next carries it.
  - *The autosave is asked for by the first frame seen on or after a second morning* (`controller.ts`), not
    only by one that falls on it: a page that is sent fewer frames may see none on a given day. While the
    browser is still deciding which tab holds the slot, the morning stays owed instead of being counted as kept.
  - *A frame that says time has started or stopped is shown at once*, not held back by the top bar's limit of
    eight redraws a second. A slow page is sent two frames close together — one that waited for it, one made
    the moment it took that — and the second, the one that says "paused", used to wait a turn.
  - *The test asserts what is promised*: the slot holds this world from no earlier than the last second
    morning the page had seen while time ran, and no later than where the world stopped. Neither bound
    depends on how fast anything is. It now watches until the seventh morning, so the save cannot be the first
    or the second ever written; and when it fails it says what the slot held.
- **Evidence.** The same script against both builds on this machine (`scripts/trail.mjs`;
  `evidence/after-20/trail-before.md`, `trail-after.md`). Page slowed twenty times, world at 64×: "paused"
  shown after 0.7–0.9 s (was 31–39 s), the picture ran on 111–247 ticks (was 2,079–3,359), the page's timer
  1.1–1.2 s late (was 17–27 s). Every other row is within what the same row varies by between runs: the
  unslowed page trails by about a third of a second before and after, which is one turn of the software
  rasterizer that draws it here. The world lived at the pace asked in every row of both tables.
  `src/worker/sim.worker.test.ts` has four tests for the pacing (a page that takes each frame is sent thirty a
  second at thirty and twelve at twelve; one that takes none is sent one, the world runs on, and the frame
  sent when it does take one is the world as it is, carrying every event the missing frames would have; a
  slow page is sent one for each it takes and the world keeps the tick it would have kept; surplus answers buy
  nothing). Each of three deliberate breakages of the mechanism fails at least one of them. The browser tests
  for this area pass (`evidence/after-20/e2e-resilience.txt`), and so does the whole suite on both projects,
  here and on GitHub's runners (`e2e-run.txt`, `ci.txt`).
- **Affected acceptance tests.** `tests/e2e/resilience.spec.ts` › the two-tabs test (rewritten assertions);
  `src/worker/sim.worker.test.ts` (four new; the test's stand-in page now answers frames, as a page does).
  `scripts/worker-pace.ts` answers frames too. Unchanged: every engine test, digest and study hash — what the
  page looks at changes nothing in a world, and one of the new tests says so by comparing hashes.
- **Cost / risks.** One small message from the page for every frame. A page that never answered would be sent
  one frame and no more: the answer is given in one place, for every frame, in a `finally`. **Not measured on
  any device**, like everything else about drawing: on a page that keeps up, frames are sent exactly as before
  (the first of the four tests), and that is all that can be said from here. This bounds a queue; it does not
  make a slow renderer fast — the picture still trails by one turn of the page.
- **Rollback.** The `taken` message and the two variables in the worker bring back the old behaviour. The
  autosave's "on or after" and the test's assertions do not depend on it and should stay.

## D-051 — The bounded copy holds no negative zero (2026-11-26)

- **Problem.** CI's unit job failed on a commit that changed only documents (run 45730650133, `0e2fbc9`). A
  property test in `src/engine/core/bounded.test.ts` tries 400 values a run, drawn at random and differently
  every run; this run drew a negative zero. `boundedCopy` kept it, `JSON.stringify` writes it as `0`, and so a
  copy written to a decision record and read back was not the copy. The function promises plain JSON data — it
  is what makes a model's charter safe to keep before the validator has judged it — and for this one value
  the promise did not hold. Replayed with the seed and path the log printed, it fails the same way.
- **Why this is a decision.** `bounded.ts` is engine code, and the engine is frozen at 0.7.0.
- **Alternatives.** (a) Have the test treat the two zeros alike: the gap between the function and its promise
  stays, unseen. (b) Refuse a negative zero as out of bounds: a whole charter would be thrown away because a
  model wrote `-0` where it meant nought. (c) Keep it as `0`, which is what JSON does to it and what the
  engine's canonical form already writes.
- **Decision.** (c): one line, `return v === 0 ? 0 : v;`. The engine's version stays 0.7.0.
- **Why the version stays.** No digest, snapshot hash or study hash can move. They are made from the engine's
  canonical text, which already writes a negative zero as `0` (`core/canonical.ts`) — and that line is the
  only place in the engine that tells the two zeros apart: no other `Object.is`, no sign test, no division by
  a value that could be one. The copy is applied to charters and motions that arrive from minds outside the
  engine (`mind/external.ts`) and to stored worlds being checked. Of the published worlds only the bundled
  recording has outside minds, and it replays to its recorded digests.
- **Evidence.** `evidence/after-20/negative-zero.txt`: the failure; its replay with CI's seed before the change
  (fails, counterexample `-0`) and after (passes); 20,000 further cases; `pnpm test`, 496 of 496.
- **Affected acceptance tests.** `bounded.test.ts`: one new test for the case, and the property now tries the
  values that failed on every run, whatever else chance offers it.
- **Cost / risks.** None known. A test that draws its cases at random can fail on a commit that has nothing
  to do with it. That is the price of its finding things. Its log prints the seed: replay it; do not run it
  again and hope.
- **Rollback.** The one line.

## D-052 — On a phone, what the camera looks at is drawn where it can be seen (2026-11-26)

- **Problem.** Two reports from the owner, on the deployed game, on their own phone: the first from a person
  other than the builder, and from a physical device.
  1. *"Crowding words at opening of app"*, with a picture of the Recordings sheet: the name of the recording
     in a sliver at the left, one word to a line and drawn over the paragraph above it; the rest of the row
     running off the right edge. A row was a grid of "what is left" and "as wide as its words", the second
     forbidden to wrap. Measured on the deployed build at 320, 360, 390 and 430 px: the name 44 px wide on
     five lines, the row 240 to 350 px past its list, the sheet scrolling sideways. Every list of rows
     shared the style; the list of saved worlds showed the same fault (44 px, seven lines), the world lines
     did not with the words they held.
  2. *"Following a person doesn't seem to move the camera and track them."* It did not, to the eye. On a
     narrow screen a citizen's card is a sheet over the lower part of the map; the camera drew whoever it
     followed at the middle of the canvas; the middle of the canvas was behind the sheet. Measured at
     390 × 844 on the deployed build: the person followed drawn at (195, 406), under their card, which
     reached from 213 to 703; with time running, under it in 29 samples of 29. Closing the card to look
     ended the follow, because closing it clears the selection. The browser test pressed Follow and read that the button said
     "Following".
  Looking at Follow turned up four more things, none of them reported:
  3. A tapped citizen was hidden the same way from the moment their card opened.
  4. Zooming, turning or tilting the view ended a follow without saying so: a pinch to see the person better
     let go of them.
  5. Choosing another citizen while following left the camera tracking the first, with the card and its
     button about the second.
  6. Each frame the camera was moved before the people, with a step capped at a tenth of a second: at the
     few frames a second of a slow device it trailed a walker by a tile or more (on a desktop page here, at
     8×, up to 64 px from where they were held on the deployed build and 13 px with the change; one run of
     twelve seconds each).
- **Original proposal.** `docs/CHARTER.md` §7: "Follow selected — Follow button in the bottom sheet", and
  phase 12's bottom sheets on portrait phones. Nothing said where on the screen a followed person is drawn,
  and nothing measured it.
- **Alternatives.** (a) Make the sheet shorter or see-through: the person is still under it. (b) Close the
  card while following and show a small "Following …" chip: the card is lost, and a second way to stop
  following has to be invented. (c) Push the camera down by a fixed amount on phones: right on one screen.
  (d) Measure what the interface covers and draw the camera's point of interest in the middle of the rest;
  open a card drawn back, so that there is a rest. Chosen.
- **Decision.**
  1. *Rows.* A row is a name and what is said about it: side by side when both fit, the second below the
     first when they do not; neither is squeezed and nothing is aligned by baseline. A row with a button at
     its end (a saved world and its delete) keeps the button at the end at every width.
  2. *What the interface covers is measured* on narrow screens (880 px and less, where panels are sheets):
     every bar and sheet over the map, top or bottom by which half of the map its middle is in, whenever one
     appears, goes or changes size (`controller.measureCover`, `ui/game/cover.ts`). The camera cuts its
     picture from the same lens off-centre (`PerspectiveCamera.setViewOffset`), so that the point it looks at
     is drawn in the middle of the uncovered band: eased, at once with reduced motion, never more than four
     tenths of the height from the centre. On a wide screen panels are at the sides and nothing is moved.
  3. *A card opens drawn back* on a narrow screen: its head, what the citizen is doing, who decided, and the
     first buttons, in at most 34% of the height or 290 px. A tap on its head, a pull up or its arrow opens
     it in full; the arrow or a tap draws it back; a pull down or the cross closes it. Following draws it
     back. At the side of a wide screen it is always whole and has no arrow.
  4. *On a narrow screen choosing a citizen or a place turns the camera to it*, without changing the zoom —
     unless the camera was just sent somewhere on purpose (to where a Chronicle or journal entry happened).
  5. *A follow ends* when the view is moved across the ground, when someone or somewhere else is chosen, when
     the card is closed, or when Follow is pressed again. Zooming, turning and tilting do not end it.
  6. *Each frame people take their places, then the camera moves*, and the camera's easing is given the time
     that really passed (a second at most); what is animated keeps its tenth-of-a-second step.
- **Evidence.** `evidence/after-20/sight-before.{md,json}` (the deployed build, from `main` at `1bb4759`)
  against `sight-after.{md,json}` (this tree), both made by `scripts/sight.mjs`, with stills of each step:
  on a phone the tapped person is at (195, 286) and the followed one at (195, 274), the map itself on top of
  them, above a card drawn back to 416; a zoom keeps the follow; under something in 0 samples of 30.
  `rows.txt`: the repository's row check against both builds. `follow.txt`: the 25 unit tests; seventeen
  rules each broken on purpose and each noticed by a test; the old "camera keeps the first person" put back
  and caught by the whole-loop test; `play.spec.ts` on both projects on this tree; the whole suite green on
  GitHub's runners on `7d8a306` (run 45752121337). `sight-live.{md,json}`: the deployed site measured again
  after the merge — the row whole at six sizes, a followed citizen in sight in 35 samples of 35.
- **How it reached `main`.** In two parts. The fixes and their tests were merged by the owner as pull request
  7 (`7d8a306`) while this record was still being written. This record, the evidence and three small changes
  made after that commit — a card that is tapped or pulled up eases open; the button does not say "Following"
  when a Chronicle entry has just sent the camera elsewhere; the arithmetic of what is covered as a function
  with tests — were merged as pull request 8 (`1a00bf3`), green on GitHub's runners (run 45758359951) and
  looked for on the site afterwards (`evidence/after-20/after-pr8.txt`). The first two of those three mended
  faults that the first part had itself brought in, and which were live for the forty minutes between the two
  merges (`docs/QA_REPORT.md` § Found while fixing).
- **Affected acceptance tests.** `tests/e2e/play.spec.ts`, whole loop, both projects: a tapped citizen is in
  sight above their card (phone); the card opens and draws back by its arrow and its head; the person
  followed is drawn in the middle of the uncovered map; a drag lets go and says so; Follow brings them back
  to within 12 px of where they were held; a zoom keeps the follow; over a quarter of a day at 8× they are
  never under a bar or the card and never more than 70 px from where they are held; choosing someone else
  lets go of the first, in the camera as on the button. A new test measures the Recordings sheet at seven
  sizes; the lists of saved worlds, world lines and recordings are measured wherever a flow meets them
  (`tests/e2e/layout.ts`). Unit: `render/cameraRig.test.ts` (11), `render/pick.test.ts` (3),
  `ui/game/swipe.test.ts` (2 more). The old assertion — the button says "Following" — is kept, beside the new
  ones.
- **Cost / risks.** On a phone a card now takes a second touch to read in full, and the map moves when
  something is chosen and when a card opens or closes; neither was so before. With a card open in full at
  390 × 844 only about 54 px of map is left, and a followed citizen is drawn in that strip; at 320 × 568 the
  drawn-back card leaves about 74 px. The first report's picture also showed the name drawn *over* the
  paragraph above it, which Chromium does not do with the same styles: it is taken to be the phone's engine
  aligning a five-line name by its last line, the alignment is gone, and **that part is not verified** — no
  such engine is installed here. Nothing in this decision has been seen on a physical phone by the builder.
- **Rollback.** Remove the call to `useMapCover` (the camera is then told of no cover and draws at the
  centre) and start `inspectorCompact` false on selection; restore `.row` to its grid. The camera's order of
  work and its time step are independent of the rest.

## D-053 — Naturalistic citizens and island surfaces (2026-11-27)

- **Problem.** At close range the citizens read as pawns. Broad, flat patches of turf and triangular grass reinforced the miniature effect even at eye level.
- **Visual direction.** Use the supplied Seven Wonders reference for the naturalism of its surfaces, coast and lighting. Keep Tabula Rasa's own island, scale and cut-away diorama.
- **Alternatives.** Imported skinned models could add anatomical detail, with new art licensing, download and animation-retargeting work. The existing procedural renderer can add the visible features with shared geometry and preserve the connection between simulation actions and poses.
- **Decision.** Build shared sculpted figures with articulated elbows and knees, stable physique and appearance, and a compact weave texture generated in the browser. Draw only the hats, tools and loads present in each frame. Use simpler meshes at the vista, and focus the closer Follow camera on the citizen’s body. Add layers of vegetation colour, narrower grass and reeds, terrain relief shading and crossed wave normals on Medium and High. Retain simplified geometry and shaders on Low.
- **Evidence and checks.** See [Evidence](EVIDENCE.md#citizen-and-island-realism-d-053-2026-11-27). A renderer unit test covers packed props, load visibility during work, and removal of both limbs on death. The game loop exercises selection, follow and the offline world on desktop and phone viewports.
- **Cost and risks.** Assets and shaders run in the browser with the existing Three.js dependency. Finer meshes and surface shading add GPU work. SwiftShader captures verify appearance and give submitted geometry counts. Performance on physical devices remains unmeasured.
- **Rollback.** Revert the graphics change. It adds no asset service, schema migration, simulation rule or save format change.
