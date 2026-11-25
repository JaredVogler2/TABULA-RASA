/**
 * Thin route: every decision is made in src/server/api.ts, behind the owner gate.
 */
import { runView } from "@/server/api";

export const maxDuration = 30;

export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]">): Promise<Response> {
  const { id } = await ctx.params;
  return runView(request, id);
}
