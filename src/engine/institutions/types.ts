/**
 * Institution state shell. The rule grammar, validator and interpreter are built in
 * phase 09; this file defines the container the world state carries from the start so
 * that snapshots keep one schema.
 */

export interface InstitutionsState {
  nextId: number;
  proposals: unknown[];
  institutions: unknown[];
  motions: unknown[];
  pacts: unknown[];
}

export function emptyInstitutions(): InstitutionsState {
  return { nextId: 1, proposals: [], institutions: [], motions: [], pacts: [] };
}
