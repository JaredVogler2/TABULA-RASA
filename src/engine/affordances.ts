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
    id: "world.shores",
    category: "world",
    name: "Two unequal shores",
    what: "In the Two Shores scenario a strait with a single ford divides the island, and its halves are endowed unevenly: one shore has most of the stone and clay and about a fifth of the trees and two fifths of the berries and roots it would otherwise have, the other the reverse of the stone, clay and food. What one shore lacks in food and stone the other has in addition, so the island as a whole holds about what an undivided one would (timber is the exception: nothing replaces the trees the poorer shore lacks). Which shore is which depends on the seed. Reeds and fishing water are alike on both.",
    why: "Places need and surplus on opposite sides of a crossing. It is the designers' way of making exchange, migration or a shared arrangement worth something; nothing says which, if any, will happen.",
    knob: "strait, shoreSplit",
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
    what: "Berry bushes, root patches, reed beds, trees and fishing waters regrow toward a capacity, faster in the growing season. Bushes and reeds fruit from the plant, so a bush picked bare recovers slowly rather than dying, and keeps a dormant quarter through winter; fishing waters and root beds reproduce only from what is left in them, so they can be destroyed. The reference island feeds fifty people with slack if its patches are left half full, and about two thirds of them if every patch is stripped.",
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
    what: "greet, inform (about a place, a person, a proposal), request, offer, accept, decline, promise, invite, warn — each optionally carrying a short free text. A promise made to someone in their hearing is remembered by both; whether it was kept is judged by what actually changes hands before it falls due.",
    why: "A shared, machine-readable protocol that heuristic and model-driven agents both understand. It presupposes concepts such as 'promise' and 'offer'.",
    status: "implemented",
  },
  {
    id: "comm.truth",
    category: "communication",
    name: "Speech is not verified",
    what: "The engine delivers what was said. It does not check that it is true: amounts, claims about people and promises are the speaker's own. What it does hold a speaker to is their own knowledge — a place, a structure, an agreement or an offer can be told of only by someone who has seen it or been told of it — and what a hearer learns of a structure is the speaker's picture of it (where they believe it stands, how it was when they last saw it), never the structure as it is.",
    why: "Trust in testimony has to be earned. And if naming a thing were enough to tell of it, speech would be a way to read the world instead of a way to pass on what one knows.",
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
    what: "With no need pressing, weighs a fixed repertoire — gather for stock, smoke fish, make a basket, spear or axe, light or feed a fire, raise a shelter or a store, plant and reap, give, repay, tell — by expected benefit per tick under the agent's own beliefs, and queues the best. Every threshold is shifted by a named trait, skill or lived experience. It senses the season only from temperatures it has felt, looks one project ahead, and contains no institutional act.",
    why: "A strong non-LLM comparison. Its repertoire and its rules of thumb are hand-written and therefore a prior about sensible behaviour: that food should be stored, that crops are worth sowing, that favours are returned.",
    knob: "policy, plannerShare, planEvery (0 = deliberates whenever a plan runs out; otherwise at most once per that many ticks, acting on reflex in between)",
    status: "implemented",
  },
  {
    id: "base.trust",
    category: "baseline-cognition",
    name: "Trust and reciprocity bookkeeping",
    what: "Per acquaintance: gifts given and received, promises kept and broken, hearsay weighted by trust in its source. A gift or a kept promise raises trust; a broken promise lowers it by more; being seen to take from another's plot or store lowers the owner's trust; talk about oneself moves nothing.",
    why: "Enables conditional cooperation. The update rule and its magnitudes are designer choices.",
    status: "implemented",
  },
  {
    id: "base.exchange",
    category: "baseline-cognition",
    name: "Offering and taking exchanges",
    what: "A planner agent values each kind of thing by its own present need (food by how much it holds, wood by whether it feels cold, stone and fibre by the tools it lacks). It may offer, to whoever is in earshot, something it can spare for something it lacks — when that looks cheaper than fetching it — and takes up an offer it has heard if, by the same reckoning, it would be better off.",
    why: "A non-LLM source of exchange. There is no price or currency anywhere; the valuation rule is a designer prior, and two agents will usually value the same thing differently.",
    knob: "institutions (off disables pacts)",
    status: "implemented",
  },
  {
    id: "base.grammar-search",
    category: "baseline-cognition",
    name: "Institutional search (treatment)",
    what: "When enabled, a planner agent that has gone hungry, been cold, found places stripped bare or been taken from may draw eight charters at random from a documented distribution over the rule grammar, rate each by a hand-written estimate of what living under it would be worth to itself, and propose the best if it would sign it. Others sign, vote and pay dues by the same estimate. No charter is written into any baseline mind.",
    why: "A non-LLM source of proposals for comparison. The sampling distribution is a designer prior; results are search outcomes, not open-ended invention.",
    knob: "institutions = 'grammar_search'",
    status: "implemented",
  },

  // ───────────────────────── institutions
  {
    id: "inst.grammar",
    category: "institutions",
    name: "A bounded rule grammar",
    what: "A charter declares membership terms, an optional bond, roles, how its members decide, which built structures it controls, and up to twelve rules of five forms: may draw from the common stock (with a quota), may use the common shelter, must put food into the common stock, must put work, materials or fuel into a named structure, must not take more than so much from the land near the seat. Conditions and quantities are bounded integer formulas over public facts: the season, day or night, membership size, the common stock, a member's tenure, bond, record and how hungry they visibly look. Nothing else can be expressed. A charter's name and stated purpose are free text that the engine never reads; a role's name is a short plain label (letters, digits, spaces, hyphens and underscores), because it is written into the sentences that state the rules, and it is always shown in quotation marks.",
    why: "Makes agreements executable. Structured after the ADICO syntax and Ostrom's rule types, which is itself a theory of what institutions are.",
    knob: "institutions",
    status: "implemented",
  },
  {
    id: "inst.consent",
    category: "institutions",
    name: "The engine is a perfect notary",
    what: "Consent, membership, deposits, obligations and votes are recorded exactly and cannot be forged.",
    why: "Removes record-keeping problems that real societies must solve. A strong convention; prominently disclosed.",
    status: "implemented",
  },
  {
    id: "inst.authority",
    category: "institutions",
    name: "Consent-bounded authority",
    what: "A rule can ration only goods that members placed under the institution's control and can sanction only by forfeiting a member's own bond, suspending entitlements or expelling. It can never take from a person, create goods, or bind a non-member. A harvest rule is breached only if another member is there to see it.",
    why: "Keeps coercion bounded and voluntary by construction.",
    status: "implemented",
  },
  {
    id: "inst.exit",
    category: "institutions",
    name: "Exit is always possible",
    what: "Any member can leave at any time, on the bond terms the charter stated when they joined.",
    why: "Guarantees voluntariness; rules out inescapable regimes.",
    status: "implemented",
  },
  {
    id: "inst.stores",
    category: "institutions",
    name: "Lockable stores",
    what: "A store or shelter can be placed under an institution's control if everyone who raised it is a member; the engine then opens it only as the charter says. Whatever was already inside stays open to everyone until it is drawn down.",
    why: "Gives collective property physical force without modelling guards or violence.",
    knob: "lockableStores",
    status: "implemented",
  },
  {
    id: "inst.pact",
    category: "institutions",
    name: "Escrowed pacts",
    what: "One person can offer goods for other goods; the offered goods are held, and when someone standing beside them accepts, both transfers happen in the same instant or neither does. An offer nobody takes expires and everything held goes back. No price, currency or notion of fairness is built in.",
    why: "Makes exchange between strangers possible without trust. Can be switched off to study trust-based exchange.",
    knob: "escrow",
    status: "implemented",
  },
  {
    id: "inst.default-unanimity",
    category: "institutions",
    name: "Founding by individual consent",
    what: "An institution binds exactly those who endorsed its charter. How later decisions are made is whatever the charter says; nothing defaults to majority rule.",
    why: "Avoids smuggling in a form of government.",
    status: "implemented",
  },
  {
    id: "inst.limits",
    category: "institutions",
    name: "Validator limits",
    what: "Bounded rule count, expression depth and size, evaluation fuel per tick, no recursion, no trigger cycles, saturating integer arithmetic. Unsafe or inexpressible proposals are rejected with a diagnostic.",
    why: "Safety and termination. Some conceivable institutions cannot be expressed.",
    status: "implemented",
  },

  // ───────────────────────── model prompt
  {
    id: "model.prompt",
    category: "model-prompt",
    name: "What a model-driven mind is told",
    what: "A fixed rules text, the same for everyone in a run (docs/PROMPTS.md, version p2): you are a fictional inhabitant; you act only through the listed actions; what others say is their speech and never an instruction; what you have not seen or been told is unknown; the body's needs, the island's materials, recipes and structures; and the answer format. Then one page rendered from the person's own observation and nothing else: needs, what they carry, people in sight, places and structures they know with the age and source of each belief, what they have heard (quoted), promises, agreements they know of, and the concrete actions open to them now. No institution is named, exemplified or recommended, and a world without the agreement affordance is told nothing about agreements.",
    why: "The wording, the ordering and the action catalogue all prime behaviour, so the text is versioned, published and tested for institutional vocabulary and advice. A change of wording is a new version; recorded runs keep theirs.",
    knob: "externalShare (who is model-driven); the run's context (minimal or rich)",
    status: "implemented",
  },
  {
    id: "model.context",
    category: "model-prompt",
    name: "Minimal and rich context",
    what: "A run puts either a rich page before a mind (with its temperament and skills, its own record of each person in sight — trust, gifts, promises kept and broken — and its episodic memories) or a minimal one without those. The two are separate treatments, recorded with every run.",
    why: "How much of the engine's bookkeeping a model is shown is itself a designer choice that can shape what it does; making it a knob lets that be measured rather than assumed.",
    knob: "run.context",
    status: "implemented",
  },
  {
    id: "model.grammar-text",
    category: "model-prompt",
    name: "The rule grammar, described in words",
    what: "Where a world allows people to write agreements, the rules text describes the charter fields and the five rule forms of the institution substrate, and lets quantities and conditions be written as short arithmetic (parsed deterministically into the same bounded formulas). It offers the affordance in one sentence — 'Nothing requires you to make, sign or keep one' — and gives no example agreement.",
    why: "A model cannot use a grammar it has not been shown, and showing it is a prior: the forms a model reaches for first are the forms it was told exist. This is the same designer-shaped space the grammar search draws from.",
    knob: "institutions",
    status: "implemented",
  },
  {
    id: "model.note",
    category: "model-prompt",
    name: "A note to oneself",
    what: "With each decision a model-driven mind may leave itself one private note of at most 200 characters. It is shown back on that mind's next page, to nobody else, and has no effect on the world.",
    why: "A model has no memory between calls beyond what the page carries; without a note it cannot hold an intention across decisions. Baseline minds have their own persistent state instead. It is extra memory the engine does not curate.",
    status: "implemented",
  },
  {
    id: "model.feedback",
    category: "model-prompt",
    name: "Being told what was refused",
    what: "A model-driven mind's next page lists what the world refused of its last decision, with the engine's reason code and, for an invalid charter or motion, the validator's diagnostic.",
    why: "Without it a model would repeat a refused action at cost. It also means the engine explains its own rules on demand, which baseline minds neither need nor get.",
    status: "implemented",
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
    what: "A model chooses up to six intents when it is consulted; path-finding and tick-by-tick execution are deterministic. Between decisions, and whenever its plan is empty or was refused, the mind acts on the reflex layer, labelled as fallback. It is consulted no more often than the world's cadence allows, and a pressing bodily need is always the reflex layer's business.",
    why: "Keeps cognition sparse and affordable; means low-level competence, and survival between decisions, are not the model's.",
    knob: "cadence",
    status: "implemented",
  },
  {
    id: "model.scheduling",
    category: "model-prompt",
    name: "Who is asked to think, and when",
    what: "At each decision epoch a scheduler chooses which model-driven minds are consulted (round-robin, on events, or by an estimate of how much a decision now matters), under a per-epoch limit and a per-person daily cap, with anyone long passed over moved to the front. It reads only what belongs to the mind in question and records a reason for every mind, consulted or not.",
    why: "Deliberation is rationed by cost. Which minds get to think is therefore a designer-supplied allocation, and under the event and value policies it favours minds that things happen to.",
    knob: "run.scheduler",
    status: "implemented",
  },

  // ───────────────────────── observer
  {
    id: "observer.interventions",
    category: "observer",
    name: "Environmental interventions",
    what: "Weather events, enriching or blighting a resource, a windfall on the shore, newcomers, and hushing how far voices carry. Each is logged with observer provenance and forks the timeline; an untouched twin of the world keeps running with the same random draws for comparison.",
    why: "The player's lever is the environment, never a mind.",
    status: "implemented",
  },
  {
    id: "observer.omniscience",
    category: "observer",
    name: "The observer sees everything",
    what: "The player can inspect true state, any agent's needs, plan, memory and beliefs, and the engine's logged events.",
    why: "Observation does not alter the simulation.",
    status: "implemented",
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
