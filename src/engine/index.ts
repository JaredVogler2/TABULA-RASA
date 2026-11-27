/**
 * Public surface of the simulation engine. Hosts (browser worker, Node scripts, server)
 * import from here; nothing outside src/engine reaches into engine internals.
 */
export { AFFORDANCE_VERSION, DIGEST_COMPATIBLE_ENGINES, ENGINE_VERSION, SCHEMA_VERSION } from "./version";
export { affordanceRegistry, AFFORDANCES, AFFORDANCE_CATEGORIES } from "./affordances";
export type { Affordance, AffordanceCategory } from "./affordances";

export * from "./model/constants";
export { DEFAULT_CONFIG, SCENARIOS, configHash, makeConfig, scenarioById, validateConfig, yearLength } from "./model/config";
export type { InstitutionMode, PolicyKind, ScenarioDef, ScheduledShock, ShockKind, SpawnMode, WorldConfig } from "./model/config";
export * from "./model/types";

export { Stream, below, seedFromString, u32 } from "./core/rng";
export { sha256Hex, sha256Text, utf8 } from "./core/hash";
export { canonicalJson, parseCanonical } from "./core/canonical";

export { createWorld, ROOT_BRANCH } from "./world/create";
export { generateTerrain } from "./world/terrain";
export { shoreSides } from "./world/nodes";
export { calendarAt, dayLength, daylight, hearingRadius, seasonalMean, sightRadius, COMFORT_TEMP } from "./world/climate";
export type { Calendar } from "./world/climate";

export { run, step } from "./sim/step";
export type { EventOut } from "./sim/events";
export { applyIntervention } from "./sim/environment";
export { auditGoods, carriedWeight, carryCapacity, foodEnergy, foodUnits, totalGoods, worthOf } from "./sim/inventory";
export { scratchOf } from "./sim/scratch";
export { hasSeen } from "./sim/pathfind";

export { SnapshotError, cloneWorld, forkWorld, restoreWorld, serializeWorld, snapshotHash, worldDigest } from "./save/snapshot";
export { MAX_BUNDLE_CHARS, diffManifests, manifestOf, openBundle, packBundle, replayTo } from "./save/history";
export type { BundleExtras, Manifest, OpenedBundle, WorldBundle } from "./save/history";
export { commonsHealthPermille, giniPermille, summarize } from "./metrics/accumulate";
export type { Summary } from "./metrics/accumulate";

// crafts, works and the readings an observer steers by (worlds with `crafts`)
export { LEGACY_POINTS, ageTitle, legacyOf, needText, needsOf, readAges, standingAge, tally } from "./metrics/ages";
export type { AgeNeed, AgeReading, Legacy, Tally } from "./metrics/ages";
export { ARRIVAL_CHANCE, ARRIVAL_LARDER, ARRIVAL_SPARE_BEDS, bedsOf, besideStream, bindable, holdsGoods, knows, practised, streamRuns } from "./sim/works";
export { agentCapacity, livingLimit } from "./world/population";

// minds: the contract for external decision makers, and the baselines' own tools
export { buildObservation, carriedFoodEnergy, maskAllows, DECISION_LIMITS, OBSERVATION_VERSION } from "./mind/observe";
export type { ActionOption, Observation, ObservedCivics } from "./mind/observe";
export { cleanText, dueForDecision, observe, replayRecord, replayTape, submitDecision, tapeFromEvents } from "./mind/external";
export { cleanLabel } from "./core/text";
export { PAYLOAD_BOUNDS, boundedCopy } from "./core/bounded";
export type { DecisionOutcome, DecisionRecord, Dropped, ExternalDecision } from "./mind/external";
export { FEEDBACK_LIMITS } from "./mind/feedback";
export { mockDecision } from "./mind/mock";
export { urgentNeed } from "./mind/reflex";

// institutions
export { GRAMMAR_VERSION, LIMITS as INSTITUTION_LIMITS } from "./institutions/types";
export type { Charter, Diagnostic, Expr, Institution, Motion, MotionBody, Origin, Pact, Proposal, Rule, Sanction } from "./institutions/types";
export { validateCharter } from "./institutions/validate";
export { FORMULA_MAX_CHARS, formatFormula, parseFormula } from "./institutions/formula";
export type { FormulaResult } from "./institutions/formula";
export { showExpr } from "./institutions/expr";
export { controllerFor } from "./world/population";
export { describeMotion, describeRule, describeTerms } from "./institutions/describe";
export { sampleCharter } from "./institutions/search";
export { institutionById, proposalById } from "./institutions/engine";

// society measures, computed from the ledger
export { SocietyTracker, modularity, RECIPROCITY_WINDOW, E3_EVENTS, E4_DAYS } from "./metrics/society";
export type { InstitutionRecord, LadderCount, SocietyReport } from "./metrics/society";

