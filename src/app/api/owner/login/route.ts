/**
 * Thin route: every decision is made in src/server/api.ts, behind the owner gate.
 */
import { login } from "@/server/api";

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return login(request);
}
