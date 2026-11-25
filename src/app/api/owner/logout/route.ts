/**
 * Thin route: every decision is made in src/server/api.ts, behind the owner gate.
 */
import { logout } from "@/server/api";

export const maxDuration = 10;

export async function POST(request: Request): Promise<Response> {
  return logout(request);
}
