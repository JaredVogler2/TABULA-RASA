/**
 * Structural validation of intents.
 *
 * Intents can originate outside the engine (a language model, a replay file, a test).
 * Before any handler looks at an intent, this gate guarantees that every field has the
 * right type and a sane range, so handlers can never be driven into NaN arithmetic,
 * out-of-bounds indexing or oversized loops. Semantic checks (range, ownership,
 * permission, availability) remain with the handlers in actions.ts.
 */
import { ITEM_COUNT, RECIPES, STRUCTURE_SPECS } from "../model/constants";
import type { Intent, SpeechAct, WorldState } from "../model/types";

const MAX_QTY = 10_000;
const MAX_TICKS = 960;
const MAX_TEXT_IN = 2_000;

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

const SPEECH_TYPES = new Set([
  "greet",
  "inform_node",
  "inform_structure",
  "inform_agent",
  "request",
  "offer",
  "accept",
  "decline",
  "promise",
  "announce",
  "invite",
  "warn",
  "free",
]);
const CLAIMS = new Set(["gave", "helped", "took", "kept", "broke"]);

export function checkSpeechAct(world: WorldState, act: unknown): string | null {
  if (!act || typeof act !== "object") return "malformed";
  const a = act as Record<string, unknown>;
  if (typeof a.t !== "string" || !SPEECH_TYPES.has(a.t)) return "unknown_speech_act";
  const big = 100_000_000;
  switch (a.t as SpeechAct["t"]) {
    case "greet":
    case "free":
      return null;
    case "inform_node":
      return isInt(a.node, 0, world.nodes.count - 1) && isInt(a.amount, 0, 30_000) && isInt(a.tick, 0, big) ? null : "malformed";
    case "inform_structure":
      return isInt(a.structure, 0, big) ? null : "malformed";
    case "inform_agent":
      return isInt(a.about, 0, world.agents.length - 1) && typeof a.claim === "string" && CLAIMS.has(a.claim) && isInt(a.tick, 0, big)
        ? null
        : "malformed";
    case "request":
      return isInt(a.item, 0, ITEM_COUNT - 1) && isInt(a.qty, 1, MAX_QTY) ? null : "malformed";
    case "offer":
      return isInt(a.give, 0, ITEM_COUNT - 1) && isInt(a.giveQty, 1, MAX_QTY) && isInt(a.want, 0, ITEM_COUNT - 1) && isInt(a.wantQty, 1, MAX_QTY)
        ? null
        : "malformed";
    case "accept":
    case "decline":
      return isInt(a.ref, 0, big) ? null : "malformed";
    case "promise":
      return isInt(a.item, 0, ITEM_COUNT - 1) && isInt(a.qty, 1, MAX_QTY) && isInt(a.due, 0, big) ? null : "malformed";
    case "announce":
      return isInt(a.proposal, 0, big) ? null : "malformed";
    case "invite":
      return isInt(a.institution, 0, big) ? null : "malformed";
    case "warn":
      return isInt(a.node, 0, world.nodes.count - 1) ? null : "malformed";
    default:
      return "unknown_speech_act";
  }
}

/** Returns null if the intent is structurally sound, otherwise a rejection reason code. */
export function checkIntent(world: WorldState, intent: unknown): string | null {
  if (!intent || typeof intent !== "object") return "malformed";
  const i = intent as Record<string, unknown>;
  const size = world.config.size;
  const big = 100_000_000;
  switch (i.k as Intent["k"]) {
    case "goto":
      return isInt(i.x, 0, size - 1) && isInt(i.y, 0, size - 1) && isInt(i.near, 0, 6) ? null : "bad_tile";
    case "explore":
    case "drink":
    case "fill":
      return null;
    case "gather":
      return isInt(i.node, 0, world.nodes.count - 1) && isInt(i.qty, 1, MAX_QTY) ? null : "malformed";
    case "eat":
    case "drop":
    case "pickup":
      return isInt(i.item, 0, ITEM_COUNT - 1) && isInt(i.qty, 1, MAX_QTY) ? null : "malformed";
    case "rest":
    case "wait":
      return isInt(i.ticks, 1, MAX_TICKS) ? null : "malformed";
    case "craft":
      return isInt(i.recipe, 0, RECIPES.length - 1) ? null : "unknown_recipe";
    case "build":
      return isInt(i.kind, 0, STRUCTURE_SPECS.length - 1) && isInt(i.x, 0, size - 1) && isInt(i.y, 0, size - 1) ? null : "bad_tile";
    case "supply":
    case "deposit":
    case "withdraw":
      return isInt(i.structure, 0, big) && isInt(i.item, 0, ITEM_COUNT - 1) && isInt(i.qty, 1, MAX_QTY) ? null : "malformed";
    case "work":
      return isInt(i.structure, 0, big) && isInt(i.ticks, 1, MAX_TICKS) ? null : "malformed";
    case "refuel":
      return isInt(i.structure, 0, big) && isInt(i.qty, 1, MAX_QTY) ? null : "malformed";
    case "harvest":
    case "inspect":
      return isInt(i.structure, 0, big) ? null : "malformed";
    case "give":
      return isInt(i.to, 0, world.agents.length - 1) && isInt(i.item, 0, ITEM_COUNT - 1) && isInt(i.qty, 1, MAX_QTY) ? null : "malformed";
    case "say": {
      if (!isInt(i.to, -1, world.agents.length - 1)) return "malformed";
      if (i.text !== undefined && (typeof i.text !== "string" || i.text.length > MAX_TEXT_IN)) return "malformed";
      return checkSpeechAct(world, i.act);
    }
    case "propose":
      return i.charter !== null && typeof i.charter === "object" ? null : "malformed";
    case "endorse":
      return isInt(i.proposal, 0, big) ? null : "malformed";
    case "motion":
      return isInt(i.institution, 0, big) && i.motion !== null && typeof i.motion === "object" ? null : "malformed";
    case "vote":
      return isInt(i.motion, 0, big) && typeof i.yes === "boolean" ? null : "malformed";
    case "leave":
      return isInt(i.institution, 0, big) ? null : "malformed";
    case "pact_offer":
      return isInt(i.to, 0, world.agents.length - 1) &&
        isInt(i.give, 0, ITEM_COUNT - 1) &&
        isInt(i.giveQty, 1, MAX_QTY) &&
        isInt(i.want, 0, ITEM_COUNT - 1) &&
        isInt(i.wantQty, 1, MAX_QTY)
        ? null
        : "malformed";
    case "pact_accept":
      return isInt(i.pact, 0, big) ? null : "malformed";
    default:
      return "unknown_intent";
  }
}
