/**
 * Plain-language descriptions of engine facts for the HUD. These are renderings of
 * state and events — never narrative invention: every sentence corresponds to a field
 * of a validated intent or a logged event.
 */
import { ITEMS, NODE_KINDS, RECIPES, STRUCTURE_KINDS, type Intent, type SpeechAct, type WorldState } from "@/engine";

export const ITEM_LABEL: Record<string, string> = {
  berry: "berries",
  root: "roots",
  fish: "fish",
  ration: "smoked rations",
  wood: "wood",
  stone: "stone",
  fiber: "fiber",
  clay: "clay",
  water: "water",
  axe: "axe",
  spear: "spear",
  basket: "basket",
  pot: "pot",
};

export const NODE_LABEL: Record<string, string> = {
  berry_bush: "berry bush",
  root_patch: "root patch",
  tree: "stand of trees",
  reed_bed: "reed bed",
  stone_outcrop: "stone outcrop",
  clay_bank: "clay bank",
  fishing_water: "fishing water",
};

export const STRUCTURE_LABEL: Record<string, string> = {
  campfire: "campfire",
  shelter: "shelter",
  store: "store",
  plot: "planted plot",
};

export function itemLabel(id: number): string {
  const name = ITEMS[id];
  return name ? (ITEM_LABEL[name] ?? name) : "something";
}

function nameOf(world: WorldState, id: number): string {
  return world.agents[id]?.name ?? "someone";
}

export function describeSpeech(world: WorldState, act: SpeechAct): string {
  switch (act.t) {
    case "greet":
      return "a greeting";
    case "inform_node": {
      const kind = NODE_KINDS[world.nodes.kind[act.node] ?? -1];
      return `where to find a ${kind ? NODE_LABEL[kind] : "resource"}`;
    }
    case "inform_structure": {
      const s = world.structures[act.structure];
      return `where a ${s ? STRUCTURE_LABEL[STRUCTURE_KINDS[s.kind]!] : "structure"} stands`;
    }
    case "inform_agent":
      return `that ${nameOf(world, act.about)} ${act.claim === "gave" ? "gave freely" : act.claim === "helped" ? "helped" : act.claim === "took" ? "took what was not theirs" : act.claim === "kept" ? "kept a promise" : "broke a promise"}`;
    case "request":
      return `a request for ${act.qty} ${itemLabel(act.item)}`;
    case "offer":
      return `an offer of ${act.giveQty} ${itemLabel(act.give)} for ${act.wantQty} ${itemLabel(act.want)}`;
    case "accept":
      return "acceptance";
    case "decline":
      return "a refusal";
    case "promise":
      return `a promise of ${act.qty} ${itemLabel(act.item)}`;
    case "announce":
      return "news of a proposal";
    case "invite":
      return "an invitation";
    case "warn":
      return "a warning that a place is stripped bare";
    case "free":
      return "something";
    default:
      return "something";
  }
}

export function describeIntent(world: WorldState, intent: Intent): string {
  switch (intent.k) {
    case "goto":
      return `walk to (${intent.x}, ${intent.y})`;
    case "explore":
      return "explore unseen ground";
    case "gather": {
      const kind = NODE_KINDS[world.nodes.kind[intent.node] ?? -1];
      return `gather from a ${kind ? NODE_LABEL[kind] : "resource"} at (${world.nodes.x[intent.node] ?? "?"}, ${world.nodes.y[intent.node] ?? "?"})`;
    }
    case "eat":
      return `eat ${itemLabel(intent.item)}`;
    case "drink":
      return "drink";
    case "fill":
      return "fill the pot with water";
    case "rest":
      return "sleep";
    case "wait":
      return "wait";
    case "craft":
      return `make ${RECIPES[intent.recipe]?.name.replace(/_/g, " ") ?? "something"}`;
    case "build":
      return `build a ${STRUCTURE_LABEL[STRUCTURE_KINDS[intent.kind] ?? ""] ?? "structure"} at (${intent.x}, ${intent.y})`;
    case "supply":
      return `bring ${itemLabel(intent.item)} to a building site`;
    case "work":
      return "work on a building site";
    case "refuel":
      return "feed the fire";
    case "harvest":
      return "harvest a plot";
    case "give":
      return `give ${intent.qty} ${itemLabel(intent.item)} to ${nameOf(world, intent.to)}`;
    case "drop":
      return `put down ${itemLabel(intent.item)}`;
    case "pickup":
      return `pick up ${itemLabel(intent.item)}`;
    case "deposit":
      return `store ${itemLabel(intent.item)}`;
    case "withdraw":
      return `take ${itemLabel(intent.item)} from a store`;
    case "say":
      return intent.to >= 0 ? `tell ${nameOf(world, intent.to)} ${describeSpeech(world, intent.act)}` : `say aloud ${describeSpeech(world, intent.act)}`;
    case "inspect":
      return "look over a structure";
    case "propose":
      return "propose a charter";
    case "endorse":
      return "endorse a proposal";
    case "motion":
      return "put a motion";
    case "vote":
      return "vote";
    case "leave":
      return "leave an institution";
    case "pact_offer":
      return `offer ${nameOf(world, intent.to)} a pact`;
    case "pact_accept":
      return "accept a pact";
    default:
      return "act";
  }
}
