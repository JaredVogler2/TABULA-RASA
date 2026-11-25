# Cognition

How a citizen of TABULA RASA comes to act, what each kind of mind is allowed to know, and where the line
between "designed" and "emergent" runs. Implemented in `src/engine/mind/`; tests in
`src/engine/mind/cognition.test.ts`. Nothing in this document describes an institution: the baseline minds
never propose one (the test suite checks the planner's source for institutional intents).

## The chain

| Stage | What it is | Where |
|---|---|---|
| Perception | What is in sight this tick: tiles, resource amounts, structures, people (position and how they *look*) | `knowledge.ts` `perceive`, `senses.ts` |
| Belief | Last known amount at each place, with the tick and the source (own eyes or a named teller); last known position of each person; known structures; the fullest each place has been seen | `Mind.node*`, `Mind.met*`, `Mind.structs` |
| Memory | Bounded episodic list with salience; the weakest (salience decayed by age) is forgotten first | `knowledge.ts` `remember` |
| Social record | Per acquaintance: trust, favours given and received, promises kept and broken; promises outstanding | `social.ts` |
| Lived season | A running mean of temperatures the agent has felt, its day-to-day trend, cold nights and hungry days lived, winters seen | `social.ts` `reflect` |
| Plan | A short queue of intents with a goal code and a reason code | `reflex.ts`, `planner.ts`, `external.ts` |
| Intent → action | Structural gate, semantic validation, duration, completion — all by the engine | `sim/intents.ts`, `sim/actions.ts` |
| Outcome | Events with causal parents; rejections carry a reason code | ledger |

A belief is never overwritten by truth except through perception or testimony. Sleeping agents perceive and
hear nothing.

## Three layers, always labelled

1. **Reflex** (`reflex.ts`, BASELINE). Serves the most pressing bodily need from what is known: drink, get warm,
   eat what is in hand or forage, sleep. It is the whole mind of `reflex` agents, the body-keeping layer of
   `planner` agents, and the labelled **fallback** of externally driven agents with no valid plan.
2. **Planner** (`planner.ts`, BASELINE). Consulted when nothing is pressing (and in hunger, because only it knows
   about stores, food on the ground and asking). Weighs a fixed repertoire by expected benefit per tick and
   queues the best project, at most six intents. In the reference configuration it is consulted whenever a
   plan runs out. `planEvery` (D-035) gives it a clock instead: at most one consultation per that many ticks,
   reflex in between — the treatment of hypothesis H5. The engine counts consultations
   (`metrics.deliberations`), whether or not a plan worth adopting was found.
3. **External** (`external.ts`). A decision supplied from outside the engine — a mock, a language model, or a
   replay of recorded intents — validated and queued exactly like a baseline plan.

Every decision record carries its source (`baseline`, `mock`, `live`, `replay`, `fallback`) and its layer.

## What the planner weighs

| Project | When it is on the table | Individual differences |
|---|---|---|
| Provision | Food in hand below the agent's target | **prudence** sets the target in days; felt cold raises it; lived winters and hungry days raise it further. Perishables count toward today only. **patience** sets the share of a patch left standing (0 / 15 / 30 / 40% of the fullest seen); hunger overrides it |
| Preserve | Two or more fresh fish and a known fire | prudence |
| Basket, spear, axe | Materials known; spear needs a known fishing water; axe once cold has been felt | **industry**, fishing skill |
| Fire | Cold sensed or remembered, or fish to cook; relit or fed at dusk | prudence |
| Shelter, store | Cold sensed or remembered (shelter); food beyond need and prudence (store). An unfinished site nearby is joined rather than duplicated | **patience**, prudence |
| Plant, reap | A root to spare, a fertile tile near home, days not yet cooling | patience, industry. Another's ripe crop is taken only by the hungry who are low in **conformity** |
| Give, repay | A debt falling due; a request heard; someone in sight who looks starving | **generosity**, trust in that person, the balance of past favours; **conformity** decides repayment when it hurts |
| Pledge | Fed while short of food | conformity + trustfulness |
| Tell | Others in earshot and nothing better to do | **sociability**; the ungenerous keep quiet about the patch by their own door |
| Explore | Nothing else | **curiosity** |

The **industry** trait sets the smallest return worth working for. All of these are rules of thumb written by
the designers; they are priors about sensible behaviour and are disclosed as such in the affordance registry.

What bounds it: it looks one project ahead, estimates travel by straight-line distance, knows yields by rule
of thumb, and has no model of anyone else's mind beyond a trust number and a ledger of favours.

## The privacy boundary

`senses.ts` is the only place where one agent learns about another at a glance: position, asleep, visibly ill,
visibly laden, and a four-step band for how hungry and how cold they look. `observe.ts` builds, from that and
from the agent's own beliefs and memories, the **Observation** handed to an external mind. It contains

- the agent's own exact needs, inventory, traits, skills and home;
- time of day, light, weather and a coarse word for the air; the agent's own cold sense (never the calendar);
- people in sight, each with the agent's *own* record of them;
- up to 14 believed places (the best of every kind, then by relevance) with amount, age and source;
- known structures with last seen state; piles in view; top memories; what was heard; commitments;
- the **action mask**: the concrete options open now.

It never contains true stocks of unseen places, anyone else's needs, inventory, goal, memory or trust, or
speech out of earshot. Tests plant sentinel values in other agents and assert that they never appear.

## External decisions

`submitDecision(world, agent, decision, source)` accepts `{ intents, goal?, rationale? }`:

- at most 6 intents; rationale ≤ 240 characters; free text in speech ≤ 160; control and bidirectional
  characters stripped;
- each intent passes the structural gate (`checkIntent`) and the action mask; refused intents are reported with
  a reason and dropped; a decision with nothing acceptable changes no world state;
- the accepted plan is queued through the same `adopt` path as a baseline plan and each intent is validated
  again when executed;
- the ledger entry stores the intents themselves, so `tapeFromEvents` + `replayTape` reproduce the run with no
  mind consulted (tested: identical physical state and identical event sequence).

The rationale is what the mind chooses to state. It is stored and shown as a quotation; it is not a transcript
of reasoning and the engine never acts on it.

## Trust

| Event | Change (0–1000 scale) |
|---|---|
| Receiving a gift | +20 + 2 × worth, at most +140 |
| A promise to me kept | +70 |
| A promise to me broken (judged at its due tick, by me only) | −130 |
| Hearsay about a third person, from a teller I trust ≥ 350 | ± 45 × (my trust in the teller ÷ 1000), once per teller, subject and day |
| Seeing my crop taken / a store I built drawn on by a non-builder | −90 / −40 |
| Talk about oneself, or about me | 0 |

The engine never checks whether hearsay is true.

## What the baselines show (development seeds only — observations, not findings)

- **As individuals, planners are far more robust.** Sharing one lean island, 65.5% of planners and 20.3% of
  reflex-only agents were alive after a year (8 seeds, 400 agents; `evidence/phase-05/lean-island-mixed-40d.txt`).
- **As societies, they are not.** On the same lean islands a population of only planners ended the year no
  larger than a population of only reflex agents (18.6 vs 18.8 of 50 alive on average), and declined earlier:
  everyone banking food draws the commons down faster. Individually sensible, collectively no better — the
  dilemma is produced by the model, not written into it (`lean-island-societies-40d.txt`).
- **On the reference island** all fifty planners were alive after two years on every one of 8 seeds; reflex-only
  populations averaged 46.4 (minimum 36) (`first-light-80d.txt`).
- Planners score lower on the well-being measure (mean of each person's worst need: 56.6% vs 63.8%): they work
  longer and rest less. Security is bought with comfort.
- Gifts are rare under both baselines (a few per thousand person-days) and promises rarer.

These runs used development seeds and were used to tune the ecology (D-014). They are not evidence for or
against any registered hypothesis.
