/**
 * Thin route: every decision is made in src/server/api.ts, behind the owner gate.
 */
import { preview } from "@/server/api";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return preview(request);
}
