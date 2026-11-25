/**
 * Thin route: every decision is made in src/server/api.ts, behind the owner gate.
 */
import { control } from "@/server/api";

export const maxDuration = 30;

export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/control">): Promise<Response> {
  const { id } = await ctx.params;
  return control(request, id);
}
