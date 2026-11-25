/**
 * Thin route: every decision is made in src/server/api.ts, behind the owner gate.
 */
import { setKill } from "@/server/api";

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return setKill(request);
}
