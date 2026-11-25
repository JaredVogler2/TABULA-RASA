/**
 * Structural validation of intents.
 *
 * Intents can originate outside the engine (a language model, a replay file, a test).
 * Before any handler looks at an intent, this gate guarantees that every field has the
 * right type and a sane range, so handlers can never be driven into NaN arithmetic,
 * out-of-bounds indexing or oversized loops. Semantic checks (range, ownership,
 * permission, availability) remain with the handlers in actions.ts.
 */
import { boundedCopy } from "../core/bounded";
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
      return isInt(a.give, 0, ITEM_COUNT - 1) && isInt(a.giveQty, 1, MAX_QTY) && isInt(a.want, 0, ITEM_COUNT - 1) && isInt(a.wantQty, 1, MAX_QTY) && (a.pact === undefined || isInt(a.pact, 0, big))
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
      return isInt(i.to, -1, world.agents.length - 1) &&
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

function plainSpeechAct(a: SpeechAct): SpeechAct {
  switch (a.t) {
    case "greet":
    case "free":
      return { t: a.t };
    case "inform_node":
      return { t: a.t, node: a.node, amount: a.amount, tick: a.tick };
    case "inform_structure":
      return { t: a.t, structure: a.structure };
    case "inform_agent":
      return { t: a.t, about: a.about, claim: a.claim, tick: a.tick };
    case "request":
      return { t: a.t, item: a.item, qty: a.qty };
    case "offer":
      return { t: a.t, give: a.give, giveQty: a.giveQty, want: a.want, wantQty: a.wantQty, ...(a.pact !== undefined ? { pact: a.pact } : {}) };
    case "accept":
    case "decline":
      return { t: a.t, ref: a.ref };
    case "promise":
      return { t: a.t, item: a.item, qty: a.qty, due: a.due };
    case "announce":
      return { t: a.t, proposal: a.proposal };
    case "invite":
      return { t: a.t, institution: a.institution };
    case "warn":
      return { t: a.t, node: a.node };
  }
}

/**
 * An intent rebuilt from the fields it is defined to have, and nothing else.
 *
 * An intent that arrives from outside the engine is kept — in the agent's plan and in the
 * decision record a run is replayed and published from — so what is kept must be exactly the
 * intent: no stray field rides along with it. A charter or a motion is carried as a bounded
 * plain copy (`boundedCopy`); the validator judges it when its turn comes. Returns null if
 * such a payload is too deep or too large to be one.
 *
 * Call only with an intent that `checkIntent` has passed. Spoken text is left as it is: its
 * length depends on who is speaking, and the caller cleans it.
 */
export function plainIntent(i: Intent): Intent | null {
  switch (i.k) {
    case "goto":
      return { k: i.k, x: i.x, y: i.y, near: i.near };
    case "explore":
    case "drink":
    case "fill":
      return { k: i.k };
    case "gather":
      return { k: i.k, node: i.node, qty: i.qty };
    case "eat":
    case "drop":
    case "pickup":
      return { k: i.k, item: i.item, qty: i.qty };
    case "rest":
    case "wait":
      return { k: i.k, ticks: i.ticks };
    case "craft":
      return { k: i.k, recipe: i.recipe };
    case "build":
      return { k: i.k, kind: i.kind, x: i.x, y: i.y };
    case "supply":
    case "deposit":
    case "withdraw":
      return { k: i.k, structure: i.structure, item: i.item, qty: i.qty };
    case "work":
      return { k: i.k, structure: i.structure, ticks: i.ticks };
    case "refuel":
      return { k: i.k, structure: i.structure, qty: i.qty };
    case "harvest":
    case "inspect":
      return { k: i.k, structure: i.structure };
    case "give":
      return { k: i.k, to: i.to, item: i.item, qty: i.qty };
    case "say":
      return { k: i.k, to: i.to, act: plainSpeechAct(i.act), ...(i.text !== undefined ? { text: i.text } : {}) };
    case "propose": {
      const charter = boundedCopy(i.charter);
      return charter.ok ? { k: i.k, charter: charter.value } : null;
    }
    case "endorse":
      return { k: i.k, proposal: i.proposal };
    case "motion": {
      const motion = boundedCopy(i.motion);
      return motion.ok ? { k: i.k, institution: i.institution, motion: motion.value } : null;
    }
    case "vote":
      return { k: i.k, motion: i.motion, yes: i.yes };
    case "leave":
      return { k: i.k, institution: i.institution };
    case "pact_offer":
      return { k: i.k, to: i.to, give: i.give, giveQty: i.giveQty, want: i.want, wantQty: i.wantQty };
    case "pact_accept":
      return { k: i.k, pact: i.pact };
  }
}
