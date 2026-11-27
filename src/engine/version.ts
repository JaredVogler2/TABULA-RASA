/**
 * Version identifiers recorded in every snapshot, ledger, manifest and decision record.
 *
 * ENGINE_VERSION    — bump whenever simulation behaviour changes (any change that could
 *                     alter a state hash for the same seed and inputs).
 * SCHEMA_VERSION    — bump whenever the serialized snapshot/ledger shape changes; add a
 *                     migration in src/engine/save/migrate.ts.
 * AFFORDANCE_VERSION— bump whenever the set of designer-supplied affordances changes
 *                     (actions, items, recipes, institution grammar, perception rules).
 */
export const ENGINE_VERSION = "0.8.0";
export const SCHEMA_VERSION = 7;
export const AFFORDANCE_VERSION = "2026.11-j";
/**
 * Engine versions whose worlds this engine steps identically, tick for tick, when a world
 * leaves the rules added since (crafts, arrivals) off — as every world made by those versions
 * does. The state digest of such a world is the digest that version computed; its file hash
 * is not, because a file also records which engine wrote it. Held to by
 * tests/unit/legacy.test.ts and scripts/legacy-digests.ts (D-055).
 */
export const DIGEST_COMPATIBLE_ENGINES: readonly string[] = ["0.7.0"];
