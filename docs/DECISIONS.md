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
  249,190 triangles, measured) — not a test-only code path. (3) All presets may lower internal resolution to
  60% when frames stay long; still captures turn that off so evidence is rendered at the stated size.
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
- **Cost / risks.** The grammar is a strong prior over what institutions can be: five rule forms, three
  sanctions, twelve public facts. Anything outside it is refused, with a reason, rather than approximated.
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
- **Evidence.** `evidence/phase-11/knowledge.jpg`; `observer.spec.ts` (toggles, and a legend that states how
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
- **Evidence.** `evidence/phase-11/charter.jpg` (a scripted control charter, labelled as such in the product).
- **Rollback.** `setMarks` in `src/render/structures.ts`.

## D-032 — A path is drawn where the engine says there is one (2026-11-25)

- **Problem.** Worn paths were invisible. Measured traffic never exceeds about 33 footfalls on any tile of the
  reference world in 40 days, and the tint only saturated near 150.
- **Decision.** One mapping, `wearOf`, shared by the ground shader, the grass and the atlas, calibrated to the
  engine's own threshold: at 24 footfalls — where the engine makes a tile cheaper to cross — the ground is
  drawn as a beaten track and the grass is gone; lighter use only dulls and flattens the turf.
- **Evidence.** `scripts`-level measurement recorded in `docs/EVIDENCE.md` (phase 11); `evidence/phase-11/paths.jpg`.
- **Rollback.** Change the constant in `src/render/palette.ts`.
