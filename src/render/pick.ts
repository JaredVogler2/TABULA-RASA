/**
 * Whether two selections are of the same thing: the same citizen, or the same place (a structure, a
 * resource and the bare ground of one tile are one place).
 */
import type { Pick } from "./WorldRenderer";

export function samePick(a: Pick | null, b: Pick | null): boolean {
  if (!a || !b) return false;
  if (a.type === "agent") return b.type === "agent" && a.id === b.id;
  return b.type !== "agent" && a.x === b.x && a.y === b.y;
}
