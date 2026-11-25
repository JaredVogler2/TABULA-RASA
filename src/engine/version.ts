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
export const ENGINE_VERSION = "0.2.0";
export const SCHEMA_VERSION = 2;
export const AFFORDANCE_VERSION = "2026.11-d";
