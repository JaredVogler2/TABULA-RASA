import { AFFORDANCE_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from "@/engine/version";

/**
 * Public liveness probe. Deliberately reveals nothing about configuration:
 * no environment names, no model id, no budget state.
 */
export async function GET() {
  return Response.json({
    ok: true,
    service: "tabula-rasa",
    engine: ENGINE_VERSION,
    schema: SCHEMA_VERSION,
    affordances: AFFORDANCE_VERSION,
  });
}
