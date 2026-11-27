# Model description (ODD)

A description of the simulation in the Overview–Design concepts–Details format used for agent-based models.
It describes engine version 0.8.0 as it is in the repository; every number below is a constant or default in
`src/engine/model/constants.ts` or `config.ts` unless a file is named. Where this document and the code
disagree, the code is the model.

Engine 0.8.0 is engine 0.7.0 with two rules that a world has to switch on (`crafts`, `arrivals`; D-055). With
both off — the default, and the setting of every published experiment — a world is stepped exactly as 0.7.0
stepped it, digest for digest (`tests/unit/legacy.test.ts`). Everything those two rules add is described in
§3.3 under "Know-how and works" and "Newcomers", and marked *(crafts)* or *(arrivals)* where it touches the
tables below.

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
| **Resource node** (about 860 on the reference island: 825–891 over seeds 1–16) | kind (berry bush, root patch, tree, reed bed, stone outcrop, clay bank, fishing water), capacity, amount | Renewable kinds regrow; stone and clay are finite. |
| **Agent** (50 by default) | position; energy, hydration, rest, warmth, health (0–1000); illness; inventory (13 items); tool wear; 9 traits, 4 physical attributes, 7 skills; current action and queued intents; **mind**; *(crafts)* the crafts known, one bit each; the tick of arrival | Traits are fixed at creation; skills grow with practice. *(arrivals)* More agents may come; none is ever born and none ages. |
| **Mind** (per agent) | tiles ever seen; believed amount, time and source for each node; the fullest each node has been seen; last known position of each other agent; trust, favours given and received, promises kept and broken per other agent; known structures; ≤ 48 episodic memories with salience; ≤ 8 commitments; ≤ 12 things heard; home; felt-temperature average and trend; cold nights, hungry days and winters lived; charters and offers known | Nothing in a mind is true by construction; it is what the agent has perceived or been told. |
| **Structure** | kind (campfire, shelter, store, plot; *(crafts)* field, granary, stone house, healing house, mill, record house), site, founder, builders, contributors, missing materials, labour, fuel (in a healing house: care laid up), contents, contents open to all, controlling institution, integrity; *(crafts)* the crafts written in a record house | Built by agents from gathered materials. |
| **Pile** | goods on the ground at a tile | Anyone may pick them up. |
| **Climate** | weather, temperature, wetness, snow, light; drought / cold-snap / rain / hush timers | One per world. |
| **Proposal, institution, motion, pact** | see `docs/INSTITUTIONS.md` | Exist only through agents' acts. |

Time: one tick is 15 simulated minutes; 96 ticks a day; four seasons of 10 days (a 40-day year). Space: one
tile is a few minutes' walk (2–4 ticks to cross, by biome). Typical runs: 40–80 days (3,840–7,680 ticks).

### 1.3 Process overview and scheduling

Each tick, in this order (`src/engine/sim/step.ts`):

1. **Environment.** Weather and temperature update; once a day: regrowth and winter die-back of nodes, spoilage
   of carried, stored and dropped food, wear of structures, ripening of plots, scheduled shocks; then, last in
   the morning's upkeep, *(crafts)* mills grind and the practised may find a craft, *(arrivals)* newcomers may
   come ashore, *(crafts)* any age reached for the first time is noted.
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
perception, and changed by testimony: a speaker can tell only of what they themselves know of, and the hearer
takes on what the speaker believed, with its age and its teller — never the state of the world (D-040). There is no reinforcement learning and no evolution in the shipped policies.

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
drainage, streams and ponds; biomes by percentile; nodes placed by biome with capacities drawn per kind, the
renewable kinds starting at 60–100% of capacity (drawn per node) and stone and clay starting full
(`world/nodes.ts`); in the scenario Two Shores alone, the chance of each kind of node also depends on the
shore (`shoreSplit` 800‰: one shore, chosen by the seed, has a fifth of the usual trees, two fifths of the
berries and roots and 1.8 times the stone and clay; the other 1.6 times the berries and roots and a fifth of
the stone and clay; D-041); 50 adults with independently drawn traits (mean 50, spread set by `diversity`), small skill
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
- **Know-how and works** *(crafts; `sim/works.ts`, D-055)*. Six crafts, each opening one work: tillage → field,
  storekeeping → granary, masonry → stone house, herb lore → healing house, millwrighting → mill (needs tillage
  and masonry), record keeping → record house (needs storekeeping and masonry). Nobody knows any at tick 0.
  *Finding one:* once a person has put in a craft's practice — tillage: 12 ticks of farming and farming skill
  240; storekeeping: 45 ticks of building and 20 of crafting; masonry: 30 of mining and 60 of building;
  millwrighting: 250 of woodcutting and 90 of building; record keeping: 60 of crafting — each morning carries
  a chance of insight (3%, 2%, 1.5%, 1.2% and 1% for the five at average curiosity; half that for the least
  curious and half as much again for the most; scaled by `learningRate`), one craft a person a day. Herb lore
  has no morning chance: someone who has foraged 300 ticks and reached foraging skill 550 may find it (15%,
  scaled the same way) on recovering from an illness. *Watching:* when someone who knows a craft finishes a
  piece of its work, each waking person in sight who has what the craft rests on may take it in (15%, scaled).
  *Reading:* inspecting a record house, a person may come away with a craft written there that they are ready
  for (35%, scaled); a record keeper inspecting one writes down a craft they know that it lacks. *The works:*
  a field (2 roots + 2 wood, on fertile ground; ripe after ten growing days — not in winter or drought; yields
  14 roots, a little more on rich ground or to a skilled hand; then stands unsown until 2 roots and a little
  labour sow it again). A granary (holds 600; food in it spoils at 120‰ of the usual rate where a store's
  spoils at 350‰). A stone house (sleeps six; warmer and more restful than a shelter; wears a fifth as fast).
  A healing house (sleeps four; only the ill or the hurt rest there; asleep in one an illness runs out twice
  as fast, and four times as fast while care is laid up, when health comes back as well — a herb knower
  deposits berries or fibre, 32 ticks of care a unit, 960 at most).
  A mill (beside a stream; each morning the stream runs, up to 36 stored roots become rations, one for one).
  A record house (holds what was written in it for as long as it stands).
- **Newcomers** *(arrivals; `sim/works.ts`, D-055)*. In spring and summer, each morning: if the dwellings
  standing have at least two beds more than there are people, and the food in stores, granaries and mills
  comes to at least 1,550 energy a head, then with probability 200‰ one to three adults come ashore, as long
  as fewer than two and a half times the founders are alive and the world's record has room (the founders,
  twenty-four, and a hundred or twice the founders, whichever is more). They are made as the founders were
  and know no craft and no person.
- **Ages and legacy** *(crafts; `metrics/ages.ts`, D-056)*. Readings for the observer, shown to no mind and
  gating nothing. An age is a threshold in what stands and what has been done (Hearths: 5 fires, 8 dwellings,
  2 stores; Fields: 3 fields, 3 field harvests; Stone: 4 stone houses, a granary; Mills: a mill, 30 roots
  ground, a healing house; Letters: 5 crafts written in one record house); the tick each is first reached is
  kept with the world. Legacy is a sum over this morning: 10 a living person, 60 a craft known, 40 a craft
  written, 150 an age reached, and each standing work up to a limit for its kind.
- **Measures** (`metrics/`). Definitions in protocol §4; the choices left open there are documented beside the
  code (ties in the interaction network are gifts, pact legs, speech addressed to one person, kept promises
  and co-founding; public speech is logged without its hearers and is not a tie).

### 3.4 What is known to be unrealistic

No births, ageing, kinship or inheritance (D-057: designed and not built; in a world that draws newcomers a
headcount grows only by adult strangers arriving). In a world with crafts, a ladder of know-how with fixed
prerequisites and six works chosen by the designers: there is no other thing to discover and no other order
to discover it in. A craft once known is never forgotten by the person, and is learned in a moment. No force. Perfect record-keeping of consent, deposits and votes. A
40-day year. Homogeneous bodies apart from four attributes. A single island with no outside. Crops that need
no tending. Monitoring that is free once someone is in sight. Each of these bounds what the model can say.
