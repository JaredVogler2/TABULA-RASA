# Affordance registry

> Generated from `src/engine/affordances.ts` (affordance version `2026.11-g`). Do not edit by hand; run `pnpm gen:affordances`.

Everything the designers supplied to the world. Read any claim that something *emerged* against this list: agents invent within these affordances; they did not invent the affordances. Entries marked *planned* describe the design and are not yet in the engine.

## World and ecology

The physical stage: land, water, seasons, weather and the laws by which resources grow, deplete and spoil.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **A bounded island**<br>`world.island` | A seed-generated island on a square grid (default 64×64 tiles) with elevation, sea, streams, ponds and biomes (shore, wetland, meadow, forest, scrub, highland). The sea bounds the world; nobody can leave. | A closed world makes resources finite and neighbours unavoidable. Grid resolution limits how fine-grained territory can be. | `size, landFraction, relief` | implemented |
| **Days, seasons and years**<br>`world.time` | 96 ticks per day, 10 days per season, four seasons per year. Daylight, temperature and plant growth follow fixed seasonal and daily curves. | Seasonality creates a predictable period of scarcity (winter) that rewards foresight and storage. | `daysPerSeason, winterSeverity, startDay` | implemented |
| **Weather**<br>`world.weather` | Clear, overcast, rain, storm and (in winter) snow, drawn from a seasonal Markov chain. Weather shifts temperature, visibility and how fast warmth is lost outdoors. | Exogenous shocks that agents cannot control but can prepare for. | `weatherVolatility` | implemented |
| **Renewable resources with collapse**<br>`world.renewables` | Berry bushes, root patches, reed beds, trees and fishing waters regrow toward a capacity, faster in the growing season. Bushes and reeds fruit from the plant, so a bush picked bare recovers slowly rather than dying, and keeps a dormant quarter through winter; fishing waters and root beds reproduce only from what is left in them, so they can be destroyed. The reference island feeds fifty people with slack if its patches are left half full, and about two thirds of them if every patch is stripped. | Creates genuine common-pool dilemmas: restraint is collectively valuable and individually costly. | `richness, regrowthRate, collapseThreshold` | implemented |
| **Finite deposits**<br>`world.finite` | Stone outcrops and clay banks hold a fixed quantity that never regenerates. | Introduces exhaustible wealth and location advantage. | `richness` | implemented |
| **Fresh water is a place**<br>`world.freshwater` | Only streams and ponds are drinkable; the sea is not. Drinking requires standing next to fresh water (or carrying water in a fired pot). | Anchors daily life to particular places without designating settlements. | — | implemented |
| **Food spoils**<br>`world.spoilage` | Fresh food decays at item-specific rates; smoked rations decay slowly; a built store slows decay. | Makes saving costly and gives shared storage a real advantage. | `spoilageRate` | implemented |
| **Travel takes time**<br>`world.terrain-cost` | Entering a tile costs ticks according to terrain and load. Repeated foot traffic wears paths that are cheaper to walk. | Distance creates search costs and local advantage; worn paths are an unowned, emergent public good. | `movementCost` | implemented |

## Bodies and needs

What it takes to stay alive. These are the only built-in objectives.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **Four needs and health**<br>`body.needs` | Energy (food), hydration, rest and warmth each fall over time and with exertion. When a need is exhausted, health falls; at zero health the agent dies. Health recovers slowly when all needs are met. | Physiological survival is the only objective the designers impose. Everything else is preference. | `metabolism` | implemented |
| **Limited carrying capacity and one action at a time**<br>`body.capacity` | An agent carries a bounded weight and performs one physical action at a time, each with a duration. | Time and load constraints are what make help, exchange and division of labour worthwhile. | — | implemented |
| **Learning by doing**<br>`body.skills` | Each agent has a skill level per activity that rises with practice (diminishing returns) and raises yield or speed. | Allows — but does not assign — specialization. | `learningRate` | implemented |
| **Death is permanent**<br>`body.death` | A dead agent stops acting; carried items fall to the ground where they stand. | Stakes. No respawning, no replacement unless the observer brings newcomers. | — | implemented |
| **Illness strikes individuals at random**<br>`body.illness` | Each day an agent has a small chance of falling ill for three to six days (higher when cold, hungry or exhausted). The ill work and walk more slowly and burn more energy. Illness is not contagious. | Idiosyncratic misfortune is what gives mutual aid and risk-sharing something to insure against. | `illness` | implemented |

## Materials, tools and structures

Generic materials and the fixed recipes that transform them.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **Generic materials**<br>`items.materials` | Berries, roots, fish, smoked rations (food); wood, stone, fiber, clay (materials); carried water. | A small material basis from which production chains can be composed. No item is designated as money. | — | implemented |
| **Fixed recipes**<br>`items.recipes` | Tools (axe, spear, basket, pot) and structures (campfire, shelter, store, drying rack, planted plot) are made from fixed material lists with fixed labour. Tools wear out. | Recipes are designer knowledge given to every agent; agents cannot invent new technology. This bounds material culture. | `recipesEnabled` | implemented |
| **Fire as a local public good**<br>`items.fire` | A fuelled campfire warms everyone within a short radius and enables smoking food and firing clay. It burns wood continuously. | A non-excludable benefit with a private cost: a built-in public-goods problem. | — | implemented |
| **Planting**<br>`items.planting` | A root can be planted on fertile ground and yields several roots after a growing period. Anyone can harvest a ripe plot. | Delayed returns that others can appropriate: the raw material for property norms. Planting is given, ownership is not. | `plantingEnabled` | implemented |

## Actions

The complete vocabulary of things an agent can ask the engine to do.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **Action vocabulary**<br>`actions.vocabulary` | move, gather, eat, drink, rest, craft, build / contribute labour, refuel, plant, give, drop, pick up, deposit, withdraw, speak, inspect, wait — plus the institutional acts listed under Institution substrate. | Agents can only do these things. Every action has explicit prerequisites, a duration, costs and failure outcomes, and is validated by the engine. | — | implemented |
| **Giving is unilateral and adjacent**<br>`actions.give` | An agent can hand items to an adjacent agent. Nothing forces a return. | Unenforced transfers make reciprocity and trust matter. | — | implemented |
| **Unattended goods can be taken**<br>`actions.take` | Anyone present can pick items up from the ground or from a store that is not bound to an institution. Carried items cannot be taken. | Appropriation must be physically possible for property to be a social fact rather than physics. The limit (no taking from bodies, no violence) is a designer simplification. | `openStoresTakeable` | implemented |
| **Fair simultaneous conflict resolution**<br>`actions.arbitration` | When several agents contend for the same units in the same tick, priority is a keyed random order re-drawn each tick. | No agent is systematically first. | — | implemented |

## Perception and knowledge

What an agent can know, and how that knowledge ages.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **Local perception**<br>`senses.local` | An agent perceives terrain, resources, structures and other agents within a radius that shrinks at night and in bad weather. It sees others' coarse condition (hungry, tired, cold, ill) and what they are doing, not their thoughts, plans or exact inventory. | No agent has a global view. The observer does. | `sightRadius` | implemented |
| **Beliefs age**<br>`senses.beliefs` | What an agent knows about a place is the last thing it saw or was told, stamped with when and from whom. Confidence decays; the world changes behind its back. | Decisions are made on stale, partial, sometimes second-hand information. | — | implemented |
| **Bounded memory**<br>`senses.memory` | A fixed-size episodic memory with salience-weighted forgetting, plus running summaries per acquaintance. | Bounded rationality. The size and scoring rule are designer choices. | `memoryCapacity` | implemented |

## Communication

How information moves between minds.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **Speech has a range**<br>`comm.range` | Public speech reaches agents within hearing distance on the next tick; a private remark reaches one nearby agent. There is no long-distance messaging. | Information diffuses through contact, so geography shapes who can coordinate. | `hearingRadius` | implemented |
| **Structured speech acts**<br>`comm.acts` | greet, inform (about a place, a person, a proposal), request, offer, accept, decline, promise, invite, warn — each optionally carrying a short free text. A promise made to someone in their hearing is remembered by both; whether it was kept is judged by what actually changes hands before it falls due. | A shared, machine-readable protocol that heuristic and model-driven agents both understand. It presupposes concepts such as 'promise' and 'offer'. | — | implemented |
| **Speech is not verified**<br>`comm.truth` | The engine delivers what was said. It does not check that it is true. | Trust in testimony has to be earned. | — | implemented |

## Baseline (non-LLM) cognition

Hand-written decision machinery used by offline agents. These are designer priors about how to think.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **Trait vector**<br>`base.traits` | Each agent has fixed traits (industry, sociability, generosity, prudence, curiosity, boldness, conformity, trustfulness, patience) and physical differences (strength, stamina, dexterity, metabolism). | Heterogeneity without assigned roles. The trait list is a psychological prior. | `diversity` | implemented |
| **Reflex policy**<br>`base.reflex` | Satisfy the most urgent need using the nearest known source; explore when nothing is known. | A competent survival floor and the fallback when a model-driven agent has no valid plan. | — | implemented |
| **Bounded-rational planner**<br>`base.planner` | With no need pressing, weighs a fixed repertoire — gather for stock, smoke fish, make a basket, spear or axe, light or feed a fire, raise a shelter or a store, plant and reap, give, repay, tell — by expected benefit per tick under the agent's own beliefs, and queues the best. Every threshold is shifted by a named trait, skill or lived experience. It senses the season only from temperatures it has felt, looks one project ahead, and contains no institutional act. | A strong non-LLM comparison. Its repertoire and its rules of thumb are hand-written and therefore a prior about sensible behaviour: that food should be stored, that crops are worth sowing, that favours are returned. | `policy, plannerShare` | implemented |
| **Trust and reciprocity bookkeeping**<br>`base.trust` | Per acquaintance: gifts given and received, promises kept and broken, hearsay weighted by trust in its source. A gift or a kept promise raises trust; a broken promise lowers it by more; being seen to take from another's plot or store lowers the owner's trust; talk about oneself moves nothing. | Enables conditional cooperation. The update rule and its magnitudes are designer choices. | — | implemented |
| **Offering and taking exchanges**<br>`base.exchange` | A planner agent values each kind of thing by its own present need (food by how much it holds, wood by whether it feels cold, stone and fibre by the tools it lacks). It may offer, to whoever is in earshot, something it can spare for something it lacks — when that looks cheaper than fetching it — and takes up an offer it has heard if, by the same reckoning, it would be better off. | A non-LLM source of exchange. There is no price or currency anywhere; the valuation rule is a designer prior, and two agents will usually value the same thing differently. | `institutions (off disables pacts)` | implemented |
| **Institutional search (treatment)**<br>`base.grammar-search` | When enabled, a planner agent that has gone hungry, been cold, found places stripped bare or been taken from may draw eight charters at random from a documented distribution over the rule grammar, rate each by a hand-written estimate of what living under it would be worth to itself, and propose the best if it would sign it. Others sign, vote and pay dues by the same estimate. No charter is written into any baseline mind. | A non-LLM source of proposals for comparison. The sampling distribution is a designer prior; results are search outcomes, not open-ended invention. | `institutions = 'grammar_search'` | implemented |

## Institution substrate

The rule grammar and the conventions that make agreements executable. Agents invent within this space; they did not invent the space.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **A bounded rule grammar**<br>`inst.grammar` | A charter declares membership terms, an optional bond, roles, how its members decide, which built structures it controls, and up to twelve rules of five forms: may draw from the common stock (with a quota), may use the common shelter, must put food into the common stock, must put work, materials or fuel into a named structure, must not take more than so much from the land near the seat. Conditions and quantities are bounded integer formulas over public facts: the season, day or night, membership size, the common stock, a member's tenure, bond, record and how hungry they visibly look. Nothing else can be expressed. | Makes agreements executable. Structured after the ADICO syntax and Ostrom's rule types, which is itself a theory of what institutions are. | `institutions` | implemented |
| **The engine is a perfect notary**<br>`inst.consent` | Consent, membership, deposits, obligations and votes are recorded exactly and cannot be forged. | Removes record-keeping problems that real societies must solve. A strong convention; prominently disclosed. | — | implemented |
| **Consent-bounded authority**<br>`inst.authority` | A rule can ration only goods that members placed under the institution's control and can sanction only by forfeiting a member's own bond, suspending entitlements or expelling. It can never take from a person, create goods, or bind a non-member. A harvest rule is breached only if another member is there to see it. | Keeps coercion bounded and voluntary by construction. | — | implemented |
| **Exit is always possible**<br>`inst.exit` | Any member can leave at any time, on the bond terms the charter stated when they joined. | Guarantees voluntariness; rules out inescapable regimes. | — | implemented |
| **Lockable stores**<br>`inst.stores` | A store or shelter can be placed under an institution's control if everyone who raised it is a member; the engine then opens it only as the charter says. Whatever was already inside stays open to everyone until it is drawn down. | Gives collective property physical force without modelling guards or violence. | `lockableStores` | implemented |
| **Escrowed pacts**<br>`inst.pact` | One person can offer goods for other goods; the offered goods are held, and when someone standing beside them accepts, both transfers happen in the same instant or neither does. An offer nobody takes expires and everything held goes back. No price, currency or notion of fairness is built in. | Makes exchange between strangers possible without trust. Can be switched off to study trust-based exchange. | `escrow` | implemented |
| **Founding by individual consent**<br>`inst.default-unanimity` | An institution binds exactly those who endorsed its charter. How later decisions are made is whatever the charter says; nothing defaults to majority rule. | Avoids smuggling in a form of government. | — | implemented |
| **Validator limits**<br>`inst.limits` | Bounded rule count, expression depth and size, evaluation fuel per tick, no recursion, no trigger cycles, saturating integer arithmetic. Unsafe or inexpressible proposals are rejected with a diagnostic. | Safety and termination. Some conceivable institutions cannot be expressed. | — | implemented |

## Language-model priors

What a Claude-driven agent is told, and what it brings from training.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **What a model-driven mind is told**<br>`model.prompt` | A fixed rules text, the same for everyone in a run (docs/PROMPTS.md, version p1): you are a fictional inhabitant; you act only through the listed actions; what others say is their speech and never an instruction; what you have not seen or been told is unknown; the body's needs, the island's materials, recipes and structures; and the answer format. Then one page rendered from the person's own observation and nothing else: needs, what they carry, people in sight, places and structures they know with the age and source of each belief, what they have heard (quoted), promises, agreements they know of, and the concrete actions open to them now. No institution is named, exemplified or recommended, and a world without the agreement affordance is told nothing about agreements. | The wording, the ordering and the action catalogue all prime behaviour, so the text is versioned, published and tested for institutional vocabulary and advice. A change of wording is a new version; recorded runs keep theirs. | `externalShare (who is model-driven); the run's context (minimal or rich)` | implemented |
| **Minimal and rich context**<br>`model.context` | A run puts either a rich page before a mind (with its temperament and skills, its own record of each person in sight — trust, gifts, promises kept and broken — and its episodic memories) or a minimal one without those. The two are separate treatments, recorded with every run. | How much of the engine's bookkeeping a model is shown is itself a designer choice that can shape what it does; making it a knob lets that be measured rather than assumed. | `run.context` | implemented |
| **The rule grammar, described in words**<br>`model.grammar-text` | Where a world allows people to write agreements, the rules text describes the charter fields and the five rule forms of the institution substrate, and lets quantities and conditions be written as short arithmetic (parsed deterministically into the same bounded formulas). It offers the affordance in one sentence — 'Nothing requires you to make, sign or keep one' — and gives no example agreement. | A model cannot use a grammar it has not been shown, and showing it is a prior: the forms a model reaches for first are the forms it was told exist. This is the same designer-shaped space the grammar search draws from. | `institutions` | implemented |
| **A note to oneself**<br>`model.note` | With each decision a model-driven mind may leave itself one private note of at most 200 characters. It is shown back on that mind's next page, to nobody else, and has no effect on the world. | A model has no memory between calls beyond what the page carries; without a note it cannot hold an intention across decisions. Baseline minds have their own persistent state instead. It is extra memory the engine does not curate. | — | implemented |
| **Being told what was refused**<br>`model.feedback` | A model-driven mind's next page lists what the world refused of its last decision, with the engine's reason code and, for an invalid charter or motion, the validator's diagnostic. | Without it a model would repeat a refused action at cost. It also means the engine explains its own rules on demand, which baseline minds neither need nor get. | — | implemented |
| **Pretraining is a cultural prior**<br>`model.pretraining` | A language model has read about markets, commons, cooperatives, governments and prior artificial-society experiments. | Model-proposed institutions may be recalled rather than invented and reflect the cultures over-represented in training data. This cannot be removed, only disclosed. | — | implemented |
| **Deterministic tactics under model strategy**<br>`model.tactics` | A model chooses up to six intents when it is consulted; path-finding and tick-by-tick execution are deterministic. Between decisions, and whenever its plan is empty or was refused, the mind acts on the reflex layer, labelled as fallback. It is consulted no more often than the world's cadence allows, and a pressing bodily need is always the reflex layer's business. | Keeps cognition sparse and affordable; means low-level competence, and survival between decisions, are not the model's. | `cadence` | implemented |
| **Who is asked to think, and when**<br>`model.scheduling` | At each decision epoch a scheduler chooses which model-driven minds are consulted (round-robin, on events, or by an estimate of how much a decision now matters), under a per-epoch limit and a per-person daily cap, with anyone long passed over moved to the front. It reads only what belongs to the mind in question and records a reason for every mind, consulted or not. | Deliberation is rationed by cost. Which minds get to think is therefore a designer-supplied allocation, and under the event and value policies it favours minds that things happen to. | `run.scheduler` | implemented |

## Observer powers

What the player can change.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **Environmental interventions**<br>`observer.interventions` | Weather events, enriching or blighting a resource, a windfall on the shore, newcomers, and changing how far voices carry. Each is logged with observer provenance and forks the timeline; an untouched twin of the world keeps running with the same random draws for comparison. | The player's lever is the environment, never a mind. | — | implemented |
| **The observer sees everything**<br>`observer.omniscience` | The player can inspect true state, any agent's needs, plan, memory and beliefs, and the engine's logged events. | Observation does not alter the simulation. | — | implemented |

## Initial conditions

How every world starts.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **Fifty unrelated adults**<br>`init.population` | Fifty adults with drawn traits and modest random skill differences, dispersed over habitable land, carrying a little food. No relationships, groups or shared history. | A blank social slate. Dispersal versus clustering is a parameter. | `population, spawn` | implemented |
| **Innate knowledge**<br>`init.knowledge` | Every agent knows its own needs, which things are edible, all recipes and the action vocabulary. It knows nothing about the map beyond what it can see, nothing about other agents, and has not experienced a winter. | Technical know-how is given; geography, people and the future are not. | — | implemented |

## Deliberately absent

Things that do not exist unless agents construct an equivalent from the affordances above.

| Affordance | What is supplied | Why, and the bias it may introduce | Experimental knob | Status |
|---|---|---|---|---|
| **No built-in social order**<br>`absent.institutions` | No government, leaders, laws, courts, money, prices, markets, jobs, wages, classes, religions, families, territories or ownership records exist in the engine. | If something like them appears, agents assembled it from the affordances above — and the registry shows from which. | — | implemented |
| **No stages, epochs or unlocks**<br>`absent.script` | There is no tech tree, no scheduled social milestone and no hidden trigger that creates an institution. An institution can only come into being through an agent's validated proposal and other agents' individual consent. | Outcomes are not scripted. | — | implemented |
| **Missing human mechanisms**<br>`absent.mechanisms` | No violence, kinship, births, ageing, contagious disease, deception detection, or evolving language. | Simplifications that limit what can be learned from the model. | — | implemented |
