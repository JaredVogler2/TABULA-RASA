/**
 * The affordance registry.
 *
 * A complete, versioned list of everything the designers supplied to the world: physics,
 * bodies, actions, senses, cognitive scaffolding, the institution grammar, prompt priors
 * and observer powers. It is rendered in the app and into docs/AFFORDANCES.md (generated
 * by `pnpm gen:affordances`) so that "what emerged" can always be read against
 * "what was given".
 *
 * Rules for editing:
 *  - Any change to simulation behaviour that adds, removes or alters something an agent
 *    can perceive or do MUST be reflected here and MUST bump AFFORDANCE_VERSION.
 *  - `knob` names a WorldConfig field that lets an experiment vary or remove the affordance.
 *  - `status`: "implemented" only when the engine actually contains it.
 */
import { AFFORDANCE_VERSION } from "./version";

export type AffordanceCategory =
  | "world"
  | "body"
  | "items"
  | "actions"
  | "senses"
  | "communication"
  | "baseline-cognition"
  | "institutions"
  | "model-prompt"
  | "observer"
  | "initial-conditions"
  | "absent";

export interface Affordance {
  id: string;
  category: AffordanceCategory;
  name: string;
  /** What exactly is supplied. */
  what: string;
  /** Why it is supplied and what bias it may introduce. */
  why: string;
  /** WorldConfig field that varies or disables it, if any. */
  knob?: string;
  status: "implemented" | "planned";
}

export const AFFORDANCE_CATEGORIES: Record<AffordanceCategory, { title: string; blurb: string }> = {
  world: {
    title: "World and ecology",
    blurb: "The physical stage: land, water, seasons, weather and the laws by which resources grow, deplete and spoil.",
  },
  body: {
    title: "Bodies and needs",
    blurb: "What it takes to stay alive. These are the only built-in objectives.",
  },
  items: {
    title: "Materials, tools and structures",
    blurb: "Generic materials and the fixed recipes that transform them.",
  },
  actions: {
    title: "Actions",
    blurb: "The complete vocabulary of things an agent can ask the engine to do.",
  },
  senses: {
    title: "Perception and knowledge",
    blurb: "What an agent can know, and how that knowledge ages.",
  },
  communication: {
    title: "Communication",
    blurb: "How information moves between minds.",
  },
  "baseline-cognition": {
    title: "Baseline (non-LLM) cognition",
    blurb: "Hand-written decision machinery used by offline agents. These are designer priors about how to think.",
  },
  institutions: {
    title: "Institution substrate",
    blurb: "The rule grammar and the conventions that make agreements executable. Agents invent within this space; they did not invent the space.",
  },
  "model-prompt": {
    title: "Language-model priors",
    blurb: "What a Claude-driven agent is told, and what it brings from training.",
  },
  observer: {
    title: "Observer powers",
    blurb: "What the player can change.",
  },
  "initial-conditions": {
    title: "Initial conditions",
    blurb: "How every world starts.",
  },
  absent: {
    title: "Deliberately absent",
    blurb: "Things that do not exist unless agents construct an equivalent from the affordances above.",
  },
};

export const AFFORDANCES: readonly Affordance[] = [
  // ───────────────────────── world
  {
    id: "world.island",
    category: "world",
    name: "A bounded island",
    what: "A seed-generated island on a square grid (default 64×64 tiles) with elevation, sea, streams, ponds and biomes (shore, wetland, meadow, forest, scrub, highland). The sea bounds the world; nobody can leave.",
    why: "A closed world makes resources finite and neighbours unavoidable. Grid resolution limits how fine-grained territory can be.",
    knob: "size, landFraction, relief",
    status: "implemented",
  },
  {
    id: "world.time",
    category: "world",
    name: "Days, seasons and years",
    what: "96 ticks per day, 10 days per season, four seasons per year. Daylight, temperature and plant growth follow fixed seasonal and daily curves.",
    why: "Seasonality creates a predictable period of scarcity (winter) that rewards foresight and storage.",
    knob: "daysPerSeason, winterSeverity, startDay",
    status: "implemented",
  },
  {
    id: "world.weather",
    category: "world",
    name: "Weather",
    what: "Clear, overcast, rain, storm and (in winter) snow, drawn from a seasonal Markov chain. Weather shifts temperature, visibility and how fast warmth is lost outdoors.",
    why: "Exogenous shocks that agents cannot control but can prepare for.",
    knob: "weatherVolatility",
    status: "implemented",
  },
  {
    id: "world.renewables",
    category: "world",
    name: "Renewable resources with collapse",
    what: "Berry bushes, root patches, reed beds, trees and fishing waters regrow logistically toward a capacity, faster in the growing season. Fishing waters and bushes regrow very slowly once nearly emptied.",
    why: "Creates genuine common-pool dilemmas: restraint is collectively valuable and individually costly.",
    knob: "richness, regrowthRate, collapseThreshold",
    status: "implemented",
  },
  {
    id: "world.finite",
    category: "world",
    name: "Finite deposits",
    what: "Stone outcrops and clay banks hold a fixed quantity that never regenerates.",
    why: "Introduces exhaustible wealth and location advantage.",
    knob: "richness",
    status: "implemented",
  },
  {
    id: "world.freshwater",
    category: "world",
    name: "Fresh water is a place",
    what: "Only streams and ponds are drinkable; the sea is not. Drinking requires standing next to fresh water (or carrying water in a fired pot).",
    why: "Anchors daily life to particular places without designating settlements.",
    status: "implemented",
  },
  {
    id: "world.spoilage",
    category: "world",
    name: "Food spoils",
    what: "Fresh food decays at item-specific rates; smoked rations decay slowly; a built store slows decay.",
    why: "Makes saving costly and gives shared storage a real advantage.",
    knob: "spoilageRate",
    status: "implemented",
  },
  {
    id: "world.terrain-cost",
    category: "world",
    name: "Travel takes time",
    what: "Entering a tile costs ticks according to terrain and load. Repeated foot traffic wears paths that are cheaper to walk.",
    why: "Distance creates search costs and local advantage; worn paths are an unowned, emergent public good.",
    knob: "movementCost",
    status: "implemented",
  },

  // ───────────────────────── body
  {
    id: "body.needs",
    category: "body",
    name: "Four needs and health",
    what: "Energy (food), hydration, rest and warmth each fall over time and with exertion. When a need is exhausted, health falls; at zero health the agent dies. Health recovers slowly when all needs are met.",
    why: "Physiological survival is the only objective the designers impose. Everything else is preference.",
    knob: "metabolism",
    status: "implemented",
  },
  {
    id: "body.capacity",
    category: "body",
    name: "Limited carrying capacity and one action at a time",
    what: "An agent carries a bounded weight and performs one physical action at a time, each with a duration.",
    why: "Time and load constraints are what make help, exchange and division of labour worthwhile.",
    status: "implemented",
  },
  {
    id: "body.skills",
    category: "body",
    name: "Learning by doing",
    what: "Each agent has a skill level per activity that rises with practice (diminishing returns) and raises yield or speed.",
    why: "Allows — but does not assign — specialization.",
    knob: "learningRate",
    status: "implemented",
  },
  {
    id: "body.death",
    category: "body",
    name: "Death is permanent",
    what: "A dead agent stops acting; carried items fall to the ground where they stand.",
    why: "Stakes. No respawning, no replacement unless the observer brings newcomers.",
    status: "implemented",
  },
  {
    id: "body.illness",
    category: "body",
    name: "Illness strikes individuals at random",
    what: "Each day an agent has a small chance of falling ill for three to six days (higher when cold, hungry or exhausted). The ill work and walk more slowly and burn more energy. Illness is not contagious.",
    why: "Idiosyncratic misfortune is what gives mutual aid and risk-sharing something to insure against.",
    knob: "illness",
    status: "implemented",
  },

  // ───────────────────────── items
  {
    id: "items.materials",
    category: "items",
    name: "Generic materials",
    what: "Berries, roots, fish, smoked rations (food); wood, stone, fiber, clay (materials); carried water.",
    why: "A small material basis from which production chains can be composed. No item is designated as money.",
    status: "implemented",
  },
  {
    id: "items.recipes",
    category: "items",
    name: "Fixed recipes",
    what: "Tools (axe, spear, basket, pot) and structures (campfire, shelter, store, drying rack, planted plot) are made from fixed material lists with fixed labour. Tools wear out.",
    why: "Recipes are designer knowledge given to every agent; agents cannot invent new technology. This bounds material culture.",
    knob: "recipesEnabled",
    status: "implemented",
  },
  {
    id: "items.fire",
    category: "items",
    name: "Fire as a local public good",
    what: "A fuelled campfire warms everyone within a short radius and enables smoking food and firing clay. It burns wood continuously.",
    why: "A non-excludable benefit with a private cost: a built-in public-goods problem.",
    status: "implemented",
  },
  {
    id: "items.planting",
    category: "items",
    name: "Planting",
    what: "A root can be planted on fertile ground and yields several roots after a growing period. Anyone can harvest a ripe plot.",
    why: "Delayed returns that others can appropriate: the raw material for property norms. Planting is given, ownership is not.",
    knob: "plantingEnabled",
    status: "implemented",
  },

  // ───────────────────────── actions
  {
    id: "actions.vocabulary",
    category: "actions",
    name: "Action vocabulary",
    what: "move, gather, eat, drink, rest, craft, build / contribute labour, refuel, plant, give, drop, pick up, deposit, withdraw, speak, inspect, wait — plus the institutional acts listed under Institution substrate.",
    why: "Agents can only do these things. Every action has explicit prerequisites, a duration, costs and failure outcomes, and is validated by the engine.",
    status: "implemented",
  },
  {
    id: "actions.give",
    category: "actions",
    name: "Giving is unilateral and adjacent",
    what: "An agent can hand items to an adjacent agent. Nothing forces a return.",
    why: "Unenforced transfers make reciprocity and trust matter.",
    status: "implemented",
  },
  {
    id: "actions.take",
    category: "actions",
    name: "Unattended goods can be taken",
    what: "Anyone present can pick items up from the ground or from a store that is not bound to an institution. Carried items cannot be taken.",
    why: "Appropriation must be physically possible for property to be a social fact rather than physics. The limit (no taking from bodies, no violence) is a designer simplification.",
    knob: "openStoresTakeable",
    status: "implemented",
  },
  {
    id: "actions.arbitration",
    category: "actions",
    name: "Fair simultaneous conflict resolution",
    what: "When several agents contend for the same units in the same tick, priority is a keyed random order re-drawn each tick.",
    why: "No agent is systematically first.",
    status: "implemented",
  },

  // ───────────────────────── senses
  {
    id: "senses.local",
    category: "senses",
    name: "Local perception",
    what: "An agent perceives terrain, resources, structures and other agents within a radius that shrinks at night and in bad weather. It sees others' coarse condition (hungry, tired, cold, ill) and what they are doing, not their thoughts, plans or exact inventory.",
    why: "No agent has a global view. The observer does.",
    knob: "sightRadius",
    status: "implemented",
  },
  {
    id: "senses.beliefs",
    category: "senses",
    name: "Beliefs age",
    what: "What an agent knows about a place is the last thing it saw or was told, stamped with when and from whom. Confidence decays; the world changes behind its back.",
    why: "Decisions are made on stale, partial, sometimes second-hand information.",
    status: "implemented",
  },
  {
    id: "senses.memory",
    category: "senses",
    name: "Bounded memory",
    what: "A fixed-size episodic memory with salience-weighted forgetting, plus running summaries per acquaintance.",
    why: "Bounded rationality. The size and scoring rule are designer choices.",
    knob: "memoryCapacity",
    status: "implemented",
  },

  // ───────────────────────── communication
  {
    id: "comm.range",
    category: "communication",
    name: "Speech has a range",
    what: "Public speech reaches agents within hearing distance on the next tick; a private remark reaches one nearby agent. There is no long-distance messaging.",
    why: "Information diffuses through contact, so geography shapes who can coordinate.",
    knob: "hearingRadius",
    status: "implemented",
  },
  {
    id: "comm.acts",
    category: "communication",
    name: "Structured speech acts",
    what: "greet, inform (about a place, a person, a proposal), request, offer, accept, decline, promise, invite, warn — each optionally carrying a short free text.",
    why: "A shared, machine-readable protocol that heuristic and model-driven agents both understand. It presupposes concepts such as 'promise' and 'offer'.",
    status: "planned",
  },
  {
    id: "comm.truth",
    category: "communication",
    name: "Speech is not verified",
    what: "The engine delivers what was said. It does not check that it is true.",
    why: "Trust in testimony has to be earned.",
    status: "implemented",
  },

  // ───────────────────────── baseline cognition
  {
    id: "base.traits",
    category: "baseline-cognition",
    name: "Trait vector",
    what: "Each agent has fixed traits (industry, sociability, generosity, prudence, curiosity, boldness, conformity, trustfulness, patience) and physical differences (strength, stamina, dexterity, metabolism).",
    why: "Heterogeneity without assigned roles. The trait list is a psychological prior.",
    knob: "diversity",
    status: "implemented",
  },
  {
    id: "base.reflex",
    category: "baseline-cognition",
    name: "Reflex policy",
    what: "Satisfy the most urgent need using the nearest known source; explore when nothing is known.",
    why: "A competent survival floor and the fallback when a model-driven agent has no valid plan.",
    status: "implemented",
  },
  {
    id: "base.planner",
    category: "baseline-cognition",
    name: "Bounded-rational planner",
    what: "Scores candidate goals (needs, stockpiling, tools, shelter, helping, exchanging, exploring, institutional acts) by expected benefit minus time and risk under the agent's beliefs and traits, with noise.",
    why: "A strong non-LLM comparison. Its utility model is hand-written and therefore a prior about rational behaviour.",
    knob: "policy",
    status: "planned",
  },
  {
    id: "base.trust",
    category: "baseline-cognition",
    name: "Trust and reciprocity bookkeeping",
    what: "Per acquaintance: gifts given and received, promises kept and broken, hearsay weighted by trust in its source.",
    why: "Enables conditional cooperation. The update rule is a designer choice.",
    status: "planned",
  },
  {
    id: "base.grammar-search",
    category: "baseline-cognition",
    name: "Institutional search (treatment)",
    what: "When enabled, an agent that has suffered a recurring problem may sample candidate charters from a documented distribution over the rule grammar, tune parameters by its own utility estimate, and propose the best.",
    why: "A non-LLM source of proposals for comparison. The sampling distribution is a designer prior; results are search outcomes, not open-ended invention.",
    knob: "institutions = 'grammar_search'",
    status: "planned",
  },

  // ───────────────────────── institutions
  {
    id: "inst.grammar",
    category: "institutions",
    name: "A bounded rule grammar",
    what: "A charter declares membership terms, roles, decision procedures, controlled stores and rules of the form 'who may / must / must not do what, when, or else what', plus automatic transfers. Expressions are bounded integer formulas over public facts.",
    why: "Makes agreements executable. Structured after the ADICO syntax and Ostrom's rule types, which is itself a theory of what institutions are.",
    knob: "institutions",
    status: "planned",
  },
  {
    id: "inst.consent",
    category: "institutions",
    name: "The engine is a perfect notary",
    what: "Consent, membership, deposits, obligations and votes are recorded exactly and cannot be forged.",
    why: "Removes record-keeping problems that real societies must solve. A strong convention; prominently disclosed.",
    status: "planned",
  },
  {
    id: "inst.authority",
    category: "institutions",
    name: "Consent-bounded authority",
    what: "A rule can move only goods that members placed under the institution's control and can sanction only by forfeiting a member's own bond, suspending entitlements or expelling. It can never take from a person, create goods, or bind a non-member.",
    why: "Keeps coercion bounded and voluntary by construction.",
    status: "planned",
  },
  {
    id: "inst.exit",
    category: "institutions",
    name: "Exit is always possible",
    what: "Any member can leave at any time, on the bond terms the charter stated when they joined.",
    why: "Guarantees voluntariness; rules out inescapable regimes.",
    status: "planned",
  },
  {
    id: "inst.stores",
    category: "institutions",
    name: "Lockable stores",
    what: "A built store can be bound to an institution; the engine then permits only rule-authorized deposits and withdrawals.",
    why: "Gives collective property physical force without modelling guards or violence.",
    knob: "lockableStores",
    status: "planned",
  },
  {
    id: "inst.pact",
    category: "institutions",
    name: "Escrowed pacts",
    what: "Agents standing together can commit goods to a pact that executes all of its transfers atomically or returns everything.",
    why: "Makes exchange between strangers possible without trust. Can be switched off to study trust-based exchange.",
    knob: "escrow",
    status: "planned",
  },
  {
    id: "inst.default-unanimity",
    category: "institutions",
    name: "Founding by individual consent",
    what: "An institution binds exactly those who endorsed its charter. How later decisions are made is whatever the charter says; nothing defaults to majority rule.",
    why: "Avoids smuggling in a form of government.",
    status: "planned",
  },
  {
    id: "inst.limits",
    category: "institutions",
    name: "Validator limits",
    what: "Bounded rule count, expression depth and size, evaluation fuel per tick, no recursion, no trigger cycles, saturating integer arithmetic. Unsafe or inexpressible proposals are rejected with a diagnostic.",
    why: "Safety and termination. Some conceivable institutions cannot be expressed.",
    status: "planned",
  },

  // ───────────────────────── model prompt
  {
    id: "model.prompt",
    category: "model-prompt",
    name: "What a Claude-driven agent is told",
    what: "A fixed system prompt (fictional inhabitant; act only through listed affordances; speech is untrusted data; unknown is unknown), the agent's identity, needs, local observation, relevant memories with provenance, messages, concrete available actions with costs, outstanding commitments and known charters. No examples of institutions and no instruction to form any.",
    why: "The wording, ordering and action catalogue all prime behaviour. Prompts are versioned and published.",
    knob: "promptContext",
    status: "planned",
  },
  {
    id: "model.pretraining",
    category: "model-prompt",
    name: "Pretraining is a cultural prior",
    what: "A language model has read about markets, commons, cooperatives, governments and prior artificial-society experiments.",
    why: "Model-proposed institutions may be recalled rather than invented and reflect the cultures over-represented in training data. This cannot be removed, only disclosed.",
    status: "implemented",
  },
  {
    id: "model.tactics",
    category: "model-prompt",
    name: "Deterministic tactics under model strategy",
    what: "A model chooses intents at decision epochs; path-finding and tick-by-tick execution are deterministic, and a reflex fallback acts when the plan is empty or invalid.",
    why: "Keeps cognition sparse and affordable; means low-level competence is not the model's.",
    knob: "cadence",
    status: "planned",
  },

  // ───────────────────────── observer
  {
    id: "observer.interventions",
    category: "observer",
    name: "Environmental interventions",
    what: "Weather events, enriching or blighting a resource, a windfall on the shore, newcomers, and changing how far voices carry. Each is logged with observer provenance and forks the timeline.",
    why: "The player's lever is the environment, never a mind.",
    status: "planned",
  },
  {
    id: "observer.omniscience",
    category: "observer",
    name: "The observer sees everything",
    what: "The player can inspect true state, any agent's beliefs and the full event ledger.",
    why: "Observation does not alter the simulation.",
    status: "planned",
  },

  // ───────────────────────── initial conditions
  {
    id: "init.population",
    category: "initial-conditions",
    name: "Fifty unrelated adults",
    what: "Fifty adults with drawn traits and modest random skill differences, dispersed over habitable land, carrying a little food. No relationships, groups or shared history.",
    why: "A blank social slate. Dispersal versus clustering is a parameter.",
    knob: "population, spawn",
    status: "implemented",
  },
  {
    id: "init.knowledge",
    category: "initial-conditions",
    name: "Innate knowledge",
    what: "Every agent knows its own needs, which things are edible, all recipes and the action vocabulary. It knows nothing about the map beyond what it can see, nothing about other agents, and has not experienced a winter.",
    why: "Technical know-how is given; geography, people and the future are not.",
    status: "implemented",
  },

  // ───────────────────────── absent
  {
    id: "absent.institutions",
    category: "absent",
    name: "No built-in social order",
    what: "No government, leaders, laws, courts, money, prices, markets, jobs, wages, classes, religions, families, territories or ownership records exist in the engine.",
    why: "If something like them appears, agents assembled it from the affordances above — and the registry shows from which.",
    status: "implemented",
  },
  {
    id: "absent.script",
    category: "absent",
    name: "No stages, epochs or unlocks",
    what: "There is no tech tree, no scheduled social milestone and no hidden trigger that creates an institution. An institution can only come into being through an agent's validated proposal and other agents' individual consent.",
    why: "Outcomes are not scripted.",
    status: "implemented",
  },
  {
    id: "absent.mechanisms",
    category: "absent",
    name: "Missing human mechanisms",
    what: "No violence, kinship, births, ageing, contagious disease, deception detection, or evolving language.",
    why: "Simplifications that limit what can be learned from the model.",
    status: "implemented",
  },
];

export function affordanceRegistry() {
  return { version: AFFORDANCE_VERSION, categories: AFFORDANCE_CATEGORIES, entries: AFFORDANCES };
}

/** Render the registry as Markdown (docs/AFFORDANCES.md is generated from this). */
export function affordancesMarkdown(): string {
  const lines: string[] = [];
  lines.push("# Affordance registry");
  lines.push("");
  lines.push(
    `> Generated from \`src/engine/affordances.ts\` (affordance version \`${AFFORDANCE_VERSION}\`). Do not edit by hand; run \`pnpm gen:affordances\`.`,
  );
  lines.push("");
  lines.push(
    "Everything the designers supplied to the world. Read any claim that something *emerged* against this list: agents invent within these affordances; they did not invent the affordances. Entries marked *planned* describe the design and are not yet in the engine.",
  );
  const order = Object.keys(AFFORDANCE_CATEGORIES) as AffordanceCategory[];
  for (const cat of order) {
    const meta = AFFORDANCE_CATEGORIES[cat];
    const entries = AFFORDANCES.filter((a) => a.category === cat);
    if (entries.length === 0) continue;
    lines.push("");
    lines.push(`## ${meta.title}`);
    lines.push("");
    lines.push(meta.blurb);
    lines.push("");
    lines.push("| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |");
    lines.push("|---|---|---|---|---|");
    for (const a of entries) {
      const cell = (s: string) => s.replace(/\|/g, "\\|");
      lines.push(
        `| **${cell(a.name)}**<br>\`${a.id}\` | ${cell(a.what)} | ${cell(a.why)} | ${a.knob ? `\`${cell(a.knob)}\`` : "—"} | ${a.status} |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
