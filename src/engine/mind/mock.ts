/**
 * A deterministic stand-in for a model-driven mind.
 *
 * It reads only an Observation and returns a decision in the same shape a language model
 * must return, so that the whole external pathway — observation, mask, validation, ledger,
 * replay — can be exercised offline and for free. It is deliberately simple and is always
 * labelled MOCK; it is not a baseline for any hypothesis.
 */
import { below, Stream } from "../core/rng";
import { FOOD_ITEMS, ITEMS, ITEM_SPECS } from "../model/constants";
import type { Intent } from "../model/types";
import type { ExternalDecision } from "./external";
import { carriedFoodEnergy, type Observation } from "./observe";

const FOOD_NAMES = new Set(FOOD_ITEMS.map((i) => ITEMS[i] as string));

export function mockDecision(obs: Observation, seed: number): ExternalDecision {
  const has = (k: string) => obs.actions.some((o) => o.k === k);
  const roll = below(100, seed, Stream.Mock, obs.tick, obs.self.id, 1);
  const intents: Intent[] = [];

  const eat = obs.actions.find((o) => o.k === "eat") as { items: number[] } | undefined;
  if (obs.self.needs.energy < 650 && eat && eat.items.length > 0) {
    // most perishable first
    const item = [...eat.items].sort((p, q) => ITEM_SPECS[q]!.spoil - ITEM_SPECS[p]!.spoil)[0] as number;
    return { intents: [{ k: "eat", item, qty: 2 }], goal: "eat", rationale: "I am getting hungry and I am carrying food." };
  }
  if (obs.self.needs.hydration < 520 && has("drink")) {
    return { intents: [{ k: "drink" }], goal: "drink", rationale: "I am thirsty and I know where water is." };
  }

  const food = obs.nodes.filter((n) => n.amount > 0 && FOOD_NAMES.has(n.yields)).sort((p, q) => p.dist - q.dist || p.id - q.id);
  if (carriedFoodEnergy(obs) < 500 && food.length > 0 && has("gather")) {
    const target = food[roll % Math.min(2, food.length)]!;
    intents.push({ k: "gather", node: target.id, qty: 3 });
    // a third of the time, tell whoever is in earshot where it was found
    const say = obs.actions.find((o) => o.k === "say") as { to: number[] } | undefined;
    if (roll % 3 === 0 && say && say.to.length > 1) {
      intents.push({ k: "say", to: -1, act: { t: "inform_node", node: target.id, amount: target.amount, tick: Math.max(0, obs.tick - target.age) }, text: "There is food here." });
    }
    return { intents, goal: "forage", rationale: `I have little food; the ${target.kind.replace("_", " ")} ${target.dist} steps away looked good.` };
  }

  const needy = obs.people.find((p) => p.looksHungry >= 2 && !p.asleep && p.dist <= 5);
  const give = obs.actions.find((o) => o.k === "give") as { to: number[]; items: number[] } | undefined;
  if (needy && give && give.to.includes(needy.id) && roll < 60) {
    const item = give.items.find((i) => FOOD_ITEMS.includes(i));
    if (item !== undefined && carriedFoodEnergy(obs) > 600) {
      return { intents: [{ k: "give", to: needy.id, item, qty: 1 }], goal: "share", rationale: `${needy.name} looks hungry and I have food to spare.` };
    }
  }

  if (roll < 55 && obs.now.light === "day") return { intents: [{ k: "explore" }], goal: "explore", rationale: "Nothing presses; I want to see what lies further on." };
  return { intents: [{ k: "wait", ticks: 6 }], goal: "idle", rationale: "I have what I need for now." };
}
