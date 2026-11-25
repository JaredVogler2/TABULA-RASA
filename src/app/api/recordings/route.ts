/**
 * Thin route: every decision is made in src/server/api.ts.
 */
import { connection } from "next/server";
import { recordings } from "@/server/api";

export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  // the list comes from the database at request time: never prerender it
  await connection();
  return recordings(request);
}
