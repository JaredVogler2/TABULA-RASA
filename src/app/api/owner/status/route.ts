/**
 * Thin route: every decision is made in src/server/api.ts, behind the owner gate.
 */
import { status } from "@/server/api";

export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  return status(request);
}
