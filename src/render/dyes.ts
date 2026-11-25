/**
 * The cloth colours that mark ratified agreements in the world and in the Charters panel.
 * One colour per institution id, so that a pennant on a store and a line in the ledger can
 * be matched by eye. Plain strings: this module is shared by the renderer and the UI.
 */
export const DYES: readonly string[] = ["#b4533c", "#3f6a8c", "#c98a2b", "#5a7d4b", "#8c5a86", "#2f6e6a", "#c26d4a", "#6b7fb0"];

export function dyeOf(institution: number): string {
  return DYES[((institution % DYES.length) + DYES.length) % DYES.length] as string;
}
