# Model description (ODD)

A description of the simulation in the Overview–Design concepts–Details format used for agent-based models.
It describes engine version 0.4.0 as it is in the repository; every number below is a constant or default in
`src/engine/model/constants.ts` or `config.ts` unless a file is named. Where this document and the code
disagree, the code is the model.

## 1. Overview

### 1.1 Purpose

To observe whether, how often and under what conditions a small population of agents with individual needs,
limited knowledge and no assigned roles comes to hold and use explicit, rule-bearing agreements — and what
difference those agreements make to survival, well-being, inequality and the state of shared resources. The
model is both a game (one world watched and perturbed by a player) and an instrument (many paired worlds
compared under registered hypotheses, `docs/EXPERIMENT_PROTOCOL.md`).

It is not a model of any historical society and supports no claim about human prehistory.

### 1.2 Entities, state variables and scales

| Entity | State | Notes |
|---|---|---|
| **Tile** (64 × 64 by default) | height, water (none / sea / stream / pond), biome (shore, wetland, meadow, forest, scrub, highland), fertility, movement cost, drinkable (perennial / seasonal), region | Static after generation. |
| **Resource node** (≈ 1,000 per island) | kind (berry bush, root patch, tree, reed bed, stone outcrop, clay bank, fishing water), capacity, amount | Renewable kinds regrow; stone and clay are finite. |
| **Agent** (50 by default) | position; energy, hydration, rest, warmth, health (0–1000); illness; inventory (13 items); tool wear; 9 traits, 4 physical attributes, 7 skills; current action and queued intents; **mind** | Traits are fixed at creation; skills grow with practice. |
| **Mind** (per agent) | tiles ever seen; believed amount, time and source for each node; the fullest each node has been seen; last known position of each other agent; trust, favours given and received, promises kept and broken per other agent; known structures; ≤ 48 episodic memories with salience; ≤ 8 commitments; ≤ 12 things heard; home; felt-temperature average and trend; cold nights, hungry days and winters lived; charters and offers known | Nothing in a mind is true by construction; it is what the agent has perceived or been told. |
| **Structure** | kind (campfire, shelter, store, plot), site, founder, builders, contributors, missing materials, labour, fuel, contents, contents open to all, controlling institution, integrity | Built by agents from gathered materials. |
| **Pile** | goods on the ground at a tile | Anyone may pick them up. |
| **Climate** | weather, temperature, wetness, snow, light; drought / cold-snap / rain / hush timers | One per world. |
| **Proposal, institution, motion, pact** | see `docs/INSTITUTIONS.md` | Exist only through agents' acts. |

Time: one tick is 15 simulated minutes; 96 ticks a day; four seasons of 10 days (a 40-day year). Space: one
tile is a few minutes' walk (2–4 ticks to cross, by biome). Typical runs: 40–80 days (3,840–7,680 ticks).

### 1.3 Process overview and scheduling

Each tick, in this order (`src/engine/sim/step.ts`):

1. **Environment.** Weather and temperature update; once a day: regrowth and winter die-back of nodes, spoilage
   of carried, stored and dropped food, wear of structures, ripening of plots, scheduled shocks.
2. **Speech** uttered last tick is delivered to those within hearing; hearers update what they know.
3. **Bodies.** Needs decay by activity; warmth exchanges with felt temperature; illness; damage when a need is
   at zero; death. Then each living mind's bookkeeping: overdue promises judged, temperature sampled, and once a
   day the day's impressions folded into expectations.
4. **Perception.** Every waking agent updates its beliefs from what is within sight.
5. **Decisions and actions**, agent by agent in an order re-drawn every tick from a keyed random permutation
   (so nobody is systematically first to a contested resource): interrupt if a new urgent need has arisen →
   decide if idle → start the next queued intent (validated; a refusal carries a reason) → advance the action.
6. **Institutions.** Lapsing proposals, period closings (obligations checked, sanctions applied), motions closing,
   expiring pacts, the scripted control if that treatment is on.
7. **Bookkeeping.** Daily sample of inequality and commons health; the tick counter advances.

State is updated asynchronously within step 5 (an agent sees the effects of those who acted before it this tick).

## 2. Design concepts

**Basic principles.** Common-pool resource theory (renewable stocks that can be over-harvested; monitoring and
graduated sanctions as things people do, not things the world does for them); bounded rationality (beliefs
from local, stale and second-hand information; one-project-ahead planning); institutions as explicit,
consented rules in the constitutive/regulative sense. The rule grammar is a deliberately narrow theory of
what an institution can be.

**Emergence.** Expected to emerge, if at all: settlement around fires, shared building, depletion and recovery
of commons, giving and reciprocity, exchange, trust networks, and institutions (proposed, adopted, used,
persistent — the E1–E4 ladder). Imposed, not emergent: needs, the ecology, the action set, the rule grammar,
the baseline minds' repertoire and judging rule (all listed in `docs/AFFORDANCES.md`).

**Adaptation.** Baseline agents choose among a fixed repertoire by expected benefit under their beliefs and
adjust thresholds from experience (cold nights and hungry days lived raise stocks and building; bare patches
found raise restraint in the prudent; broken promises and seen takings lower trust). Model-driven agents
choose intents from an observation and an action mask.

**Objectives.** Agents have no global objective. Baseline agents keep four needs away from zero and weigh
projects in energy-equivalents per tick; nothing rewards cooperation, institutions or survival of others.

**Learning.** Skills rise with practice (faster work, occasional extra yield). Beliefs are corrected by
perception and testimony. There is no reinforcement learning and no evolution in the shipped policies.

**Prediction.** Seasonal foresight comes only from a running mean and trend of temperatures the agent has
itself felt. Yields and travel are estimated by rule of thumb.

**Sensing.** Sight radius 7 tiles by day, 3 at night, less in rain and storm; hearing radius 5. Of another
person an agent perceives position, sleep, visible illness, whether they carry a load, and a four-step band
for hunger and for cold — never exact needs, inventory, plans, beliefs or trust.

**Interaction.** Direct: giving, speech acts (inform, warn, request, promise, announce, invite, offer), pacts,
joint building, institutional acts. Indirect: competition for nodes, shared warmth of a fire, shared shelters
and stores, taking from open stores and piles. No force: nothing can be taken from a person's hands.

**Stochasticity.** A counter-based keyed generator (`core/rng.ts`): every draw is a pure function of the seed,
a stream id and integer keys (tick, agent, …), so results do not depend on call order. Stochastic: terrain,
node placement, traits and skills, weather, regrowth rounding, spoilage, illness, fishing success, arbitration
order, the planner's exploration, the grammar search. A fork can keep the parent's exogenous draws (common
random numbers) or be re-keyed.

**Collectives.** Institutions: sets of consenting members with a charter. They have no agency of their own.

**Observation.** A ledger of typed events with causal parents; daily samples; the measures of protocol §4
computed from the ledger (`metrics/society.ts`) and from state (`metrics/accumulate.ts`). Agents'
self-descriptions are never used as data.

## 3. Details

### 3.1 Initialization

From a scenario and a 32-bit seed: terrain by layered value noise with a percentile sea level, priority-flood
drainage, streams and ponds; biomes by percentile; nodes placed by biome with capacities drawn per kind and
starting full; 50 adults with independently drawn traits (mean 50, spread set by `diversity`), small skill
differences and a little food, dispersed over habitable land with no relationships, groups or shared history.
Trust in everyone starts at 300 + 4 × trustfulness (clamped to 200–760). The year starts in early spring
(First Light) or as the scenario says. No structure, institution, promise or memory exists at tick 0.

### 3.2 Input data

None. Scheduled shocks, where a scenario has them, are drawn from the seed.

### 3.3 Submodels

- **Needs** (`sim/bodies.ts`). Energy falls ≈ 3 per tick awake, more when moving or working, 1.8 asleep
  (about 300 a day); hydration ≈ 5 per tick, more when active in heat; rest falls 4–6 per tick awake and
  rises 16–21 asleep (more by a fire, most in a shelter); warmth falls in proportion to how far the felt
  temperature (air − altitude + 12 °C by a fire + 8 °C in a shelter + 3 °C when active − 3 °C in rain or snow
  outdoors) is below 8 °C, and recovers at 22 per tick above it. Health falls while a need is at zero and
  recovers when all are comfortable. Illness strikes daily with a small probability raised by cold, hunger and
  exhaustion.
- **Ecology** (`sim/environment.ts`, D-014). Daily growth `rate · (stock + base·K) · (1 − stock/K)` with
  seasonal rates; `base` is 15% of capacity for bushes and reeds, 3–4% for roots and trees, 0 for fishing
  waters; below a collapse threshold (15% of capacity for bushes, 20% for fishing waters) growth is cut to 30%
  and 20%; winter die-back of fruit stops at a dormant quarter; an empty node with no base re-seeds with a
  daily probability. Droughts stop growth of bushes, roots and reeds and dry seasonal streams.
- **Goods** (`sim/inventory.ts`). Thirteen items with weight, energy, spoilage rate and tool uses. Every unit
  enters by a declared source (gathered, harvested, crafted, washed ashore) and leaves by a declared sink
  (eaten, spoiled, burned, built in, worn out); `auditGoods` checks that holdings equal sources minus sinks.
- **Actions** (`sim/actions.ts`). 28 intent kinds; each is checked structurally, then against the world, takes
  ticks that depend on skill and tools, and either completes with events or is refused with a reason code.
- **Minds** (`mind/`, `docs/COGNITION.md`). Reflex layer; bounded-rational planner; external decisions through
  one observation, one action mask and one validation path. Two clocks ration deliberation and are separate
  settings: `cadence` for minds outside the engine, `planEvery` for the planner (0, the reference value, means
  no clock).
- **Social record** (`mind/social.ts`). Promises, trust changes, hearsay; see the table in `docs/COGNITION.md`.
- **Institutions and pacts** (`institutions/`, `docs/INSTITUTIONS.md`).
- **Measures** (`metrics/`). Definitions in protocol §4; the choices left open there are documented beside the
  code (ties in the interaction network are gifts, pact legs, speech addressed to one person, kept promises
  and co-founding; public speech is logged without its hearers and is not a tie).

### 3.4 What is known to be unrealistic

No births, ageing, kinship or inheritance. No force. Perfect record-keeping of consent, deposits and votes. A
40-day year. Homogeneous bodies apart from four attributes. A single island with no outside. Crops that need
no tending. Monitoring that is free once someone is in sight. Each of these bounds what the model can say.
