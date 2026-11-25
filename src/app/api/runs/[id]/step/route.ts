/**
 * Advance a run by at most one decision epoch. For a live run this is the only route that can
 * cause a provider call, and it does so only after the owner gate has passed and the budget
 * ledger has granted a reservation (src/server/api.ts, src/server/runs.ts).
 *
 * The duration limit leaves room for calls that were started just before the step's own
 * deadline to finish and be settled.
 */
import { step } from "@/server/api";

export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/step">): Promise<Response> {
  const { id } = await ctx.params;
  return step(request, id);
}
