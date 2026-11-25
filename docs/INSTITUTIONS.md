# Institutions

The rule grammar (version 1), how an institution lives and dies, and what was deliberately left out.
Code: `src/engine/institutions/`. Tests: `institutions.test.ts`. Design basis: D-006, D-010, D-011, D-017, D-018.

Nothing in this document is an institution. The engine ships a grammar, a validator, a notary and a lock; the
only charters that ever exist are those an agent proposed and other agents individually signed. The one
exception is the labelled positive control (`scripted_control`), which is never counted as emergence.

## Three kinds of content, kept apart

| | Examples | Effect |
|---|---|---|
| **Narrative** | name, purpose, role names | None. Stored, shown in quotation marks, never interpreted. |
| **Constitutive** | who may join and on what bond; roles; how members decide; which structures are controlled; lifetime | Fixed when people sign. An amendment cannot change them. |
| **Regulative** | rules: *who* may / must / must not *do what* [*when*] [*or else*] | Enforced by the engine; replaceable by a motion that passes. |

The interface and the observations given to minds describe a charter with sentences generated from its
regulative and constitutive parts only (`describe.ts`), so a grand name cannot disguise what the rules do.

## Charter

```
{ grammar: 1, name, purpose,
  minFounders ≥ 2, maxMembers ≤ 500,
  entry: "open" | "vote" | "closed",
  bond: null | { item, qty ≤ 20 },                   posted when signing; returned on leaving unless forfeited
  roles: ≤ 4 × { name, seats ≤ 8, by: "founder" | "vote" },
  decide: { rule: "unanimity" | "majority" | "two_thirds" | "role", role?, quorum ‰ },   must be stated; nothing is assumed
  period: 24–960 ticks,                              quotas and obligations are per period
  stores: ≤ 4 structure ids,                         stores or shelters the proposer helped to raise
  rules: ≤ 12,
  days: 0 (until dissolved) … 400 }
```

## Rules

| Form | Meaning | Enforced by |
|---|---|---|
| `may_withdraw { who, item, quota, when? }` | Members in scope may draw up to `quota` of `item` (or any food) from the common stock each period. Without such a rule the store is shut, even to members. | The lock: a withdrawal is clamped to what is allowed. |
| `may_shelter { who, when? }` | Narrows who may sleep in a controlled shelter (default: any member in good standing). | The lock. |
| `must_deposit { who, item, qty, when?, else }` | Members in scope owe `qty` into the common stock each period. | Books closed at period end; shortfall is a breach. |
| `must_supply { who, structure, worth, when?, else }` | Members owe work, materials or fuel worth `worth` to a named structure each period: a building site until it is finished, or a hearth for as long as it stands (only a hearth may have `when`). | Books at period end. |
| `must_not_gather { who, kind, within, over, when?, else }` | Members may take at most `over` of a kind of resource within `within` tiles of the seat each period. | A breach is raised **only if another member is in sight** when the limit is passed. Monitoring is done by people. |

`who`: every member · holders of a role · everyone but them. Non-members are never in scope.

`else` (sanctions): `note` · `forfeit` (at most the bond posted) · `suspend` (1–30 periods without entitlements) ·
`expel` (with loss of bond). There is no other way for an institution to hurt anyone.

## Formulas

Quotas, quantities and conditions are finite trees of at most 24 nodes and depth 6: integer constants,
arithmetic (`add sub mul div min max`), comparisons, `and or not`, one conditional, and these public facts:

`members` · `day` (since ratification) · `season` · `night` · `stock(item)` (common stock only) ·
and about the member a rule is being applied to: `tenure` · `bond` · `breaches` · `deposited(item)` ·
`withdrawn(item)` (this period) · `hunger` (the 0–3 band anyone can see) · `has_role(i)`.

There are no loops, calls, variables or references to other rules, so evaluation terminates and cannot
recurse. Arithmetic saturates; division by zero is zero; each node costs one unit of fuel; period closings
share 20,000 units per tick and resume next tick where they stopped. A formula cannot read anyone's inventory,
exact needs, beliefs, memories or trust.

## Life cycle

```
propose ──validator──► open for 3 days ──minFounders signatures──► in force ──► ended
   │ refused, with diagnostics            │ too few: lapses, bonds returned      (fewer than 2 members ·
   ▼                                      ▼                                       members vote · term expires)
 nothing exists                         nothing exists
```

- **Consent.** Signing is an intent executed by one agent (`endorse`); the bond is posted at that moment. An
  agent can only sign a charter it has heard of (told aloud, or seen on a structure it controls).
- **Entry afterwards.** During the founding window anyone who knows the charter may sign it as it stands; after
  that, as the charter says: open, by vote, or closed.
- **Control of structures.** A store or shelter comes under control only when every living person who raised it
  is a member. **Whatever was inside stays open to everyone** until drawn down: a lock changes who may take what
  members add, never what others had already put there.
- **Motions** (members only): amend the rules · admit · expel · assign an elective role · grant a member a
  one-off draw · bring a structure in or release it · dissolve. The charter's own decision rule settles them;
  members who joined after a motion was moved do not vote on it.
- **Exit.** `leave` cannot be refused and returns the bond.
- **Ending.** Bonds are returned, controlled structures become open again with their contents, custody is emptied.

## Pacts

`pact_offer { to, give, giveQty, want, wantQty }` holds the offered goods (where the scenario provides escrow);
`pact_accept` by someone standing beside the offerer swaps both sides in one instant, or nothing moves. An
untaken offer expires after a day and the goods go back. Any two items, any quantities: no price is built in.

## What the validator refuses, and how it says so

Every refusal is a list of `{ path, code, message }`. Examples from the test suite: a rule form that does not
exist (`not_expressible` — "Rules cannot take from people, punish beyond a posted bond, or act on
non-members"), a fact that is not public (`unknown_fact`), a forfeit with no bond or beyond it
(`nothing_to_forfeit`, `exceeds_bond`), a structure the proposer had no hand in (`no_standing`), a missing
decision rule (`missing` — "Nothing is assumed"), an oversized or self-referential formula (`too_large`,
`too_deep`). Nothing is repaired or approximated. A refused proposal changes no state except that the refusal
is logged.

## How baseline agents use it (designer priors, disclosed)

- **Judging** (`judge.ts`). One hand-written estimate of what ten days under a set of rules would be worth to
  *this* agent: food it could draw when hungry (weighted by how often it has gone hungry and whether it senses
  cold), what it would owe, the value of a roof or of a fire others are bound to feed, the cost of harvest
  limits and the value of others' restraint to someone who has found places stripped bare, the bond at risk,
  the distance to what is controlled — scaled by trust in those already signed, plus a pull of numbers on the
  conforming. The same estimate decides signing, voting, paying dues when it pinches, and leaving.
- **Searching** (`search.ts`, treatment `grammar_search`). A planner with a recurring trouble draws eight
  charters from the distribution documented at the top of that file and proposes the one it rates highest, if
  it would sign it itself. No named template exists; the proposer's name is the only narrative it supplies.
- **The scripted control** (`scripted.ts`, treatment `scripted_control`). A designer-written "Hearth and larder"
  charter is attributed to the builder of a finished store and announced aloud. Origin is recorded as
  `scripted` everywhere, and the interface says "not emergence".

## What these runs have and have not shown (development seeds; not findings)

- Capability: voluntary exchange, mutual aid and collectively funded infrastructure are each expressed and
  executed from a scripted test proposal (`institutions.test.ts` › capability). That is a demonstration that
  the grammar *can* express them, not evidence that anyone would invent them.
- Uptake: on The Long Winter (6 seeds, 30 days) charters found by search were ratified with three or more
  founders on 6 of 6 seeds, and the control on 4 of 6. On First Light (40 days) the control was adopted on 6 of
  6 and search-found charters on none.
- Effect: **none demonstrated.** Mean survivors in The Long Winter: 35.3 with institutions off, 35.5 with
  grammar search, 31.2 with the scripted control. An isolation experiment shows why this says little: on one
  seed a control charter that nobody joined moved the death toll by 13 (`evidence/phase-09/isolation-experiment.txt`).
  Near the survival margin these worlds are chaotic; six seeds cannot tell a real effect of this size from noise.
  The registered positive-control hypothesis (H6a) may well fail, and the protocol says what follows if it does.

## Deliberately left out

Force. Taking from a person's hands. Punishment beyond a posted bond. Rules binding non-members. Automatic
transfers of goods at a distance. Inheritance, kinship, currency, prices, land title. Monitoring by the engine
of what nobody saw. Any of these may be argued for; none is assumed.
