/**
 * The mock provider: a deterministic stand-in for a model, always labelled MOCK.
 *
 * It answers in the wire format — its decision is written out as the JSON a model would
 * return and then read back through the same parser — so that everything downstream of a
 * provider is exercised exactly as it would be in a live run, at no cost. Its choices are a
 * keyed function of the observation and the world's seed. It is a test double, not a
 * baseline: nothing it does is evidence about any hypothesis.
 */
import { GRAMMAR_VERSION, ITEMS, FOOD_ITEMS, Stream, below, mockDecision, type ExternalDecision, type Intent, type Observation } from "@/engine";
import type { CallResult, DecisionCall, Provider } from "./types";
import { decisionToWire, parseWire } from "./wire";

const hasAction = (obs: Observation, k: string) => obs.actions.find((o) => o.k === k);

/**
 * What the mock mind does. Beyond the engine's own `mockDecision` (eat, drink, forage, tell,
 * share, explore) it sometimes signs, votes, trades or writes a trivial agreement, so that
 * those paths are exercised too.
 */
export function mockMind(obs: Observation, seed: number): { decision: ExternalDecision; confidence: string; cites: string[] } {
  const roll = below(1000, seed, Stream.Mock, obs.tick, obs.self.id, 7);
  const base = mockDecision(obs, seed);
  const cites = obs.heard.length ? ["h1"] : obs.memories.length && roll % 2 === 0 ? ["m1"] : [];
  const done = (decision: ExternalDecision, confidence = "medium") => ({ decision: { ...decision, note: `mock: ${decision.goal ?? "plan"} at tick ${obs.tick}` }, confidence, cites });
  // the body first: whatever the base policy does about hunger and thirst stands
  if (base.goal === "eat" || base.goal === "drink") return done(base, "high");

  const vote = hasAction(obs, "vote") as { motions: number[] } | undefined;
  if (vote && vote.motions.length) {
    return done({ intents: [{ k: "vote", motion: vote.motions[0] as number, yes: roll % 2 === 0 }], goal: "vote", rationale: "There is a motion open and I have not voted." });
  }
  const accept = hasAction(obs, "pact_accept") as { pacts: number[] } | undefined;
  if (accept && accept.pacts.length && roll < 400) {
    return done({ intents: [{ k: "pact_accept", pact: accept.pacts[0] as number }], goal: "trade", rationale: "Someone offers a trade I can meet." });
  }
  const endorse = hasAction(obs, "endorse") as { proposals: number[] } | undefined;
  if (endorse && endorse.proposals.length && roll < 250) {
    return done({ intents: [{ k: "endorse", proposal: endorse.proposals[0] as number }], goal: "sign", rationale: "I have heard of an agreement and I will sign it." }, "low");
  }
  const say = hasAction(obs, "say") as { to: number[] } | undefined;
  const mine = obs.civics?.charters.find((c) => c.state === "proposed" && c.by === obs.self.name);
  if (mine && say && say.to.length > 1 && roll < 500) {
    return done({ intents: [{ k: "say", to: -1, act: { t: "announce", proposal: mine.id }, text: "I have written an agreement. Hear it." }], goal: "announce", rationale: "People nearby should know of the agreement I wrote." });
  }
  if (hasAction(obs, "propose") && !mine && obs.civics && obs.civics.memberships.length === 0 && say && say.to.length > 1 && roll < 30) {
    const charter = {
      grammar: GRAMMAR_VERSION,
      name: `Mock accord of ${obs.self.name}`.slice(0, 40),
      purpose: "A trivial agreement written by a mock mind to exercise the machinery.",
      minFounders: 2,
      maxMembers: 12,
      entry: "open",
      bond: null,
      roles: [],
      decide: { rule: "majority", quorum: 0 },
      period: 96,
      stores: [],
      rules: [{ r: "may_shelter", who: { t: "all" }, when: { o: "or", a: { v: "night" }, b: { o: "eq", a: { v: "season" }, b: { c: 3 } } } }],
      days: 0,
    };
    return done({ intents: [{ k: "propose", charter }], goal: "propose", rationale: "I am writing an agreement to see who signs." }, "low");
  }
  const offer = hasAction(obs, "pact_offer") as { to: number[]; items: number[] } | undefined;
  if (offer && roll >= 960) {
    const give = offer.items.find((i) => !FOOD_ITEMS.includes(i) && ITEMS[i] !== "water");
    if (give !== undefined) {
      const intents: Intent[] = [{ k: "pact_offer", to: -1, give, giveQty: 1, want: FOOD_ITEMS[roll % FOOD_ITEMS.length] as number, wantQty: 1 }];
      return done({ intents, goal: "offer", rationale: "I have something to spare and could use food." }, "low");
    }
  }
  return done(base);
}

export class MockProvider implements Provider {
  readonly id = "mock" as const;
  readonly model = "mock";
  readonly paid = false;

  reserveFor(): number {
    return 0;
  }

  async decide(call: DecisionCall): Promise<CallResult> {
    const mind = mockMind(call.observation, call.seed);
    // out through the wire and back in, exactly as a model's answer would travel
    const text = JSON.stringify(decisionToWire(mind.decision, call.observation, { confidence: mind.confidence, cites: mind.cites }));
    const read = parseWire(text, call.observation);
    return {
      status: read.ok ? "ok" : "malformed",
      decision: read.decision,
      confidence: read.confidence,
      cites: read.cites,
      text,
      usage: null,
      costMicroUsd: 0,
      model: this.model,
      requestId: null,
      stopReason: "end_turn",
      error: read.ok ? null : { code: read.error ?? "malformed", status: null, retryable: false, message: read.detail ?? "" },
      latencyMs: 0,
    };
  }
}
