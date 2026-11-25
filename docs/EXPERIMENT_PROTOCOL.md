# TABULA RASA — scientific charter and experiment protocol

Status: **pre-registration**. First committed 2026-11-25, before the simulation engine, the metrics code or any
experiment existed. The git history of this file is the registration record. Deviations are appended to §10; the
registered text above them is never rewritten after a confirmatory run has been executed.

## 1. Scope of inference

TABULA RASA is a *designed* agent-based model. Anything observed in it is a property of (designer affordances ×
agent policy × seed). We therefore ask only **within-model** questions of the form "given these affordances, does
condition A change outcome Y relative to matched condition B?". We do not claim discoveries about human societies,
novelty relative to the social-science literature, or anything about consciousness or understanding in agents.
Verified prior work is listed in `LITERATURE.md`; the model description follows the ODD protocol in `ODD.md`.

## 2. Units, runs and seeds

- **Run:** one world simulated from tick 0 under a fixed configuration. Identified by
  `(engineVersion, affordanceVersion, scenario, config hash, seed, policy, decision log hash)`.
- **Matched design:** every condition in a study is run on the *same* seed set, so world geography, initial
  population and exogenous weather are identical across conditions (common random numbers). Analyses are paired.
- **Seed hygiene:** seeds `1–999` are *development* seeds (used freely while building and tuning). Seeds
  `9000–9999` are *holdout* seeds, used only by confirmatory studies and never inspected during tuning.
  Any exploratory use of a holdout seed is a deviation that must be logged.
- **Horizon:** one simulated year (40 days = 3,840 ticks) unless a study states otherwise.

## 3. Treatment factors

| Factor | Levels (registered) | Notes |
|---|---|---|
| Decision policy | `reflex` · `planner` (bounded-rational, non-LLM) · `claude` (live, owner-authorized only) · `mock` (pipeline tests only; never analysed as science) | Policy source is recorded on every decision. |
| Institution affordance | `off` · `grammar_search` (non-LLM agents may search the rule grammar) · `scripted_control` (a designer-authored charter is injected) · `open` (any agent, incl. Claude, may propose) | `scripted_control` is a positive control and is **never** counted as emergence. |
| Scarcity (resource richness) | 0.4 · 0.7 · 1.0 · 1.3 | Multiplies node counts and capacities. |
| Mobility (movement cost multiplier) | 0.5 · 1.0 · 2.0 | |
| Communication range (hearing radius, tiles) | 2 · 5 · 9 | |
| Diversity (trait and skill variance scale) | 0.2 · 1.0 | Means held equal. |
| Cognitive cadence (ticks between strategic deliberations) | 12 · 24 · 48 · 96 | For `planner` this is the replanning interval; for `claude` it is the call cadence. |
| Prompt context (Claude only) | `minimal` · `rich` | Separate treatment; see S01. |

## 4. Outcome measures (computed from engine events and state, never from agent self-reports)

| Measure | Operational definition |
|---|---|
| Survival | Living agents at horizon ÷ initial agents. |
| Welfare | Mean over living agent-ticks of the minimum of the four normalised needs (energy, hydration, rest, warmth), in [0,1]. Dead agents contribute 0 for the remaining ticks ("welfare incl. mortality"). |
| Holdings inequality | Gini coefficient of food-equivalent holdings (carried + claimable), sampled daily and averaged. Defined as 0 when total holdings are 0 or n < 2. |
| Voluntary cooperation rate | Validated `give` actions and executed pact/institution transfers to another agent, per living agent-day. |
| Reciprocity | Share of directed dyads with a transfer A→B that also have a transfer B→A within 5 days. 0 when no transfers. |
| Specialization | 1 − (mean individual Shannon entropy of work-time shares across activity classes ÷ ln k). Higher = more specialized. |
| Productivity | Resource units gathered per work tick. |
| Trade volume | Units exchanged in executed escrowed pacts plus reciprocated gift pairs, per agent-day. |
| Network modularity | Newman modularity of the weighted interaction graph (communication + transfers) under greedy agglomerative communities. |
| Institution counts | Proposals, ratifications, active institutions at horizon, member-days. |
| Commons health | Minimum over time of the mean stock ratio (stock ÷ capacity) of renewable commons nodes. |
| Collective-action success | Completed shared projects ÷ started shared projects (0 when none started). |
| Decision-influence concentration | Gini of authored-and-ratified proposals plus approved motions across agents. |
| Cost (live only) | Provider-reported tokens and settled microdollars per agent-decision. |

Descriptive metrics are never presented as normative scores.

## 5. Operational definition of emergence

An institution is scored on a ladder, each rung verified from logged events:

| Level | Criterion |
|---|---|
| E1 Proposed | A charter passed the validator and was announced by an agent. |
| E2 Adopted | Ratified with ≥ 3 individually consenting members (explicit `endorse` events). |
| E3 Used | After ratification, ≥ 10 rule-governed events (deposits, withdrawals, transfers, motions, votes) by ≥ 2 distinct members. |
| E4 Persistent | Still active with ≥ 2 members 10 or more simulated days after ratification. |
| E5 Material effect | Across seeds, a pre-specified outcome differs between worlds where institutions were available and matched worlds where they were not, with a 95% interval excluding zero. Single-world claims of material effect are not allowed; a single fork comparison is labelled *anecdote*. |

Origin is recorded and reported separately: `grammar_search`, `llm`, `mixed`, or `scripted` (never emergent).
"Emergent institution" in any report means **E4 with non-scripted origin**; E5 is a property of a study, not a run.
Human- or model-coded classifications of what an institution "is" (e.g. "a granary cooperative") are narrative
labels with stated uncertainty and are kept apart from the verified ladder.

## 6. Registered hypotheses (confirmatory family)

Primary endpoints are tested on holdout seeds with paired differences and Holm correction across the family.

- **H1 — Scarcity and cooperation (inverted U).** With `planner` agents and institutions `off`, the voluntary
  cooperation rate is higher at richness 0.7 than at 1.3, and higher at 0.7 than at 0.4.
  *Falsified if* either paired difference has a 95% interval that includes zero or has the opposite sign.
- **H2 — Mobility and specialization.** Raising movement cost from 1.0 to 2.0 increases the specialization index.
  *Falsified if* the paired difference is ≤ 0 or its interval includes zero.
- **H3 — Communication range and adoption.** With institutions `grammar_search`, the share of runs reaching E2 by
  the horizon is higher at hearing radius 9 than at radius 2.
  *Falsified if* the paired difference in E2 indicator is ≤ 0 or its interval includes zero.
- **H4 — Diversity and resilience.** Under an identical mid-run resource shock, survival is higher at diversity
  1.0 than at 0.2. *Falsified if* the paired difference is ≤ 0 or its interval includes zero.
- **H5 — Cadence has diminishing returns.** For `planner`, welfare at cadence 48 is at least 90% of welfare at
  cadence 12 (non-inferiority margin 10%), while the decision count is at most 35% of it.
  *Falsified if* the lower 95% bound of the welfare ratio is below 0.90.
- **H6a — Positive control.** In *The Long Winter*, `scripted_control` yields higher survival than `off`.
  This validates that the world gives institutions something to do. *Falsified if* the paired difference is ≤ 0 or
  its interval includes zero. A failure here means institutional affordances are not materially useful in this
  world and all E5 claims are moot until the ecology is redesigned.
- **H6b — Non-LLM institutional search.** In *The Long Winter*, `grammar_search` yields higher survival than
  `off`. Two-sided; we have no strong prior.
- **H6c — Claude agents (requires owner-authorized spend; otherwise NOT RUN).** With `claude` agents and
  institutions `open`, at least half of matched seeds reach E4 with origin `llm`. Exploratory until a budget and
  seed count are approved; never reported as a finding from fewer than the registered seeds.

Everything else (network structure, influence concentration, narrative coding of institutions, prompt-context
effects) is **exploratory** and labelled as such.

## 7. Analysis plan

- **Estimates:** per-condition mean and paired mean difference; 95% percentile bootstrap intervals (10,000
  resamples, fixed analysis seed); standardized effect size d_z for paired contrasts and Cliff's δ as a
  distribution-free companion.
- **Multiplicity:** Holm step-down across the registered family; exploratory results carry an explicit
  multiple-comparisons warning and no significance language.
- **Precision before power:** a development-seed pilot estimates the standard deviation of each paired
  difference; the confirmatory seed count is chosen to reach a target interval half-width and is recorded in the
  study manifest *before* the confirmatory batch starts.
- **Missing data:** failed, cancelled or timed-out runs are listed in every report; a condition is never analysed
  on a subset of its registered seeds without saying so.
- **Reproducibility:** every study exports a manifest (versions, configuration, seeds, hypotheses, endpoints,
  exclusions, per-run final state hash, cost) and per-run metric tables. Re-running the manifest must reproduce
  every hash.
- **Exploratory vs confirmatory** runs are stored and displayed separately.

## 8. Known confounds and limits

1. **Designer affordances.** The action vocabulary, the institution grammar, the consent "notary", lockable stores
   and escrow are supplied by us; agents can only invent within that space. See `AFFORDANCES.md`.
2. **Baseline cognitive priors.** Non-LLM agents use a hand-written utility model, trust-update rule and, in
   `grammar_search`, a designer-chosen distribution over rule skeletons. Their "inventions" are search results
   under our prior, not open-ended creativity.
3. **Pretraining contamination and cultural priors.** A language model has read about commons, cooperatives,
   Sugarscape and institutional economics. Institutions it proposes may be recalled rather than invented, and
   reflect the cultures over-represented in its training data. We measure what it does under our prompts; we do not
   infer what a naive mind would do. Prompts are versioned, published and audited for institutional priming.
4. **Omniscient but honest engine.** Consent and obligations are recorded perfectly, which real societies lack.
5. **Missing mechanisms.** No violence, kinship, births, ageing, disease transmission or language evolution.
6. **Small worlds, short horizons.** Fifty agents, one year by default.
7. **Model non-determinism.** Live model outputs are not reproducible; replays are of *recorded* decisions.
   Model or prompt version changes create new, non-comparable arms.
8. **Selection bias.** Showcase replays are chosen by people. Any curated recording states how it was chosen and
   links to the full study it came from.
9. **Researcher degrees of freedom.** Mitigated by this registration, holdout seeds and the deviation log.

## 9. Automated hypothesis suggestions

An optional "lab scientist" assistant may read exported metrics and propose new studies in the structured study
format. It cannot start runs, spend budget, edit data or alter this protocol; its suggestions are exploratory
until a human registers them here.

## 10. Deviation log

| Date | Deviation | Reason | Impact on registered analyses |
|---|---|---|---|
| 2026-11-25 | Reference ecology retuned and the growth law amended (D-014): node density ×1.5, capacity ×1.2, growth ×1.2; bushes and reeds gain a base productivity and a dormant winter reserve; re-seeding is faster. Engine 0.2.0, snapshot schema 2. | With the phase-03 ecology both baselines went nearly extinct by the second summer on every development seed examined, leaving no regime in which a treatment could be seen to help or harm. | None on registered analyses: no confirmatory run had been made, only development seeds 1–8 were used, and no holdout seed has been drawn. All pilot variance estimates must be made on the retuned ecology. |
| 2026-11-25 | The scripted control charter was revised on development seeds before any confirmatory run: it now includes an undertaking to keep a hearth in fuel in winter as well as a common larder (D-017). | A larder alone only moves food between members; the first version showed no benefit on six development seeds. | H6a is unchanged and is still to be tested on holdout seeds. The revision was made without looking at holdout seeds; it remains possible that H6a fails. |
| 2026-11-25 | Note for the analysis plan (§7): pairing by seed does not hold trajectories fixed. In an isolation experiment a perturbation of a few dozen one-tick acts changed survivors by up to 13 of 50 on one seed (`evidence/phase-09/isolation-experiment.txt`). | Observed while debugging the control. | The pilot must estimate the standard deviation of *paired differences* directly and size studies from that; no variance reduction from pairing may be assumed. |
| 2026-11-25 | A `plannerShare` setting allows mixed populations of planner and reflex agents. | Needed to compare the baselines as individuals inside one world (phase 05 gate). | Not a registered factor. Registered studies keep it at 1000. |
| 2026-11-25 | The cadence factor for `planner` agents is implemented as a separate setting, `planEvery` (engine 0.6.0), whose reference value is 0: no clock, the planner deliberates whenever its plan runs out. H5 compares `planEvery` 12 with 48; between deliberations people act on reflex. | The first pilot of H5 (development seeds 1–16) returned a welfare ratio and a decision ratio of exactly 1: the engine's `cadence` setting was read only by minds outside the engine, so the registered treatment had never reached the planner. Making the existing setting bind would have changed the reference baseline that the ecology was tuned on (D-014). | H5's treatment now exists. Its second clause is checked on the count of planner consultations ("deliberations"), which the engine now records, not on all decisions (reflex decisions fill the gaps and would hide the treatment). No holdout seed had been drawn. The pilot found the consultation ratio near one half, not one third: at cadence 12 a planner is not consulted every 12 ticks, because plans outlast that and people sleep. If that holds on holdout seeds the second clause is reported as not met; the engine is not to be tuned toward it. |
| 2026-11-25 | Richness levels (§3) are implemented relative to the retuned reference ecology of D-014: level L sets both `richness` and `nodeDensity` to L times their reference values. | The protocol predates D-014 and says only that the factor "multiplies node counts and capacities". | H1's levels 0.4, 0.7 and 1.3 are multiples of the reference ecology. At 0.4 almost nobody survives the year on development seeds; cooperation there is measured per living agent-day, as registered. |
| 2026-11-25 | Pilot result recorded before any confirmatory run (development seeds 1–16, engine 0.6.0, `evidence/phase-14/pilot/`): the scripted control charter did **not** raise survival in *The Long Winter* (mean paired difference about −0.06, interval touching zero), and H4's shock killed almost nobody in either condition (survival near 1.0 in both: a ceiling). | Reported as found. The control was last revised in D-017 on six development seeds. | H6a is expected to fail on holdout seeds, in which case — as registered — institutional affordances have not been shown to be materially useful in this world and every E5 claim is moot until the ecology or the control is redesigned. H4 as registered cannot distinguish resilience when nobody is at risk; it will be run and reported as registered, and a harsher-shock variant, if added, is exploratory. Neither test has been altered. |
| 2026-11-25 | Holdings inequality (§4) is measured more narrowly than registered. Registered: the Gini coefficient of food-equivalent holdings "(carried + claimable)". Measured by the engine (`sampleDay` and `summarize` in `src/engine/metrics/accumulate.ts`): the Gini coefficient of the worth of what each *living* agent carries — every carried item at its `worth` constant — sampled at the end of each simulated day and averaged over the days. Nothing claimable is counted: not a bond held for a member, not a right to draw from a controlled store, not goods put into a store, not a crop in the ground. | Found when this document was checked against the code after the pilot. The measure was written in phase 03 from inventories alone and was not extended when bonds, controlled stores and escrow were added in phase 09; "claimable" was never given an operational definition and appears nowhere in the code. | No registered hypothesis has inequality as its endpoint, so no registered test is affected. The pilot (`evidence/phase-14/pilot/`) used the engine's measure: its "Inequality of holdings" columns and the `gini` column of `runs.csv` are carried holdings of the living only, and say nothing about food in stores or bonds posted. The registered text is left as written. |
| 2026-11-25 | The origin of an institution (§5) has no `mixed` value. Registered: "`grammar_search`, `llm`, `mixed`, or `scripted`". Recorded by the engine (`Origin` in `src/engine/institutions/types.ts`; `originOf` and `propose` in `src/engine/institutions/engine.ts`): `grammar_search`, `llm`, `mock` or `scripted` — the kind of mind that proposed the charter (or the scripted control), kept unchanged by the institution whoever signs or amends it later. `mock` marks proposals by the test double, which is never analysed as science (§3). | Found in the same check. "Mixed" was never given an operational definition and nothing computes it. | None on the baseline studies: every institution in the pilot has origin `grammar_search` or `scripted`. For H6c (not run), an institution proposed by a model-driven mind is recorded as `llm` even when baseline minds are among its members; that has to be stated with any result. The registered text is left as written. |
| 2026-11-25 | Engine 0.7.0 before the confirmatory batch. Between the pilot and the batch the engine changed: a speaker can tell only of what they know and a hearer takes on the speaker's belief; role names are plain quoted labels; text is cleaned by an explicit list of code points; what a mind attaches to an intent is bounded (D-040); Two Shores divides its resources by shore (D-041); an opened file is validated (D-043). | An adversarial review before any live call found the gaps these close. | None found on the baseline studies. The pilot was re-run on 0.7.0 (`evidence/phase-16/pilot/`): all 224 runs end on the same state digest and with the same value of every measure as on 0.6.0 (`evidence/phase-16/pilot-compare.txt`), and the plan (32 seeds) is unchanged. None of the registered studies uses Two Shores. The batch was run on 0.7.0 and on no other version. |
| 2026-11-25 | The Holm correction is applied across the whole registered family in a batch: seven contrasts have a p-value (the two ratio contrasts of H5 are read from their intervals and have none). The analysis code first adjusted within each study's one or two contrasts. | Found when the documents were checked against the code: §6 and §7 say "across the family" and the code did not. Corrected before the confirmatory batch. | The adjusted p-values of the first pilot report (`evidence/phase-14/pilot/`) were within-study; those of `evidence/phase-16/` are family-wide. No verdict changes: verdicts come from the registered interval rules. |

## 11. Confirmatory batch (run once, 2026-11-25)

Holdout seeds 9000–9031 (32, the number fixed in the plan before the batch), engine 0.7.0, baseline minds only
(no model consulted, no cost), 448 of 448 runs finished. The batch was run exactly once and is reported as it
came out. Every run, the manifest with each run's state hash, the report and a verification that sampled cells
recompute to the same hash (16 of 16) are in `evidence/phase-16/confirmatory/`; the same bundle is what the
Laboratory page shows. Seeds 9000–9031 are spent. Seeds 9032–9999 remain unseen.

| | Claim | Paired estimate [95% interval] | p, unadjusted (Holm, family of 7) | By the registered rule |
|---|---|---|---|---|
| H1 | Cooperation is higher at richness 0.7 than at 1.3 | 0.0151 [0.0122, 0.0179] | 0.0001 (0.0007) | supported |
| H1 | Cooperation is higher at richness 0.7 than at 0.4 | 0.0109 [0.0079, 0.0138] | 0.0001 (0.0007) | supported |
| H2 | Doubling the cost of movement raises the specialization index | 0.056 [0.052, 0.060] | 0.0001 (0.0007) | supported |
| H3 | More runs reach E2 when voices carry nine tiles than two | 0.31 [0.06, 0.53] | 0.0141 (0.0564) | supported |
| H4 | After the same blight, more survive where people vary more | −0.001 [−0.003, 0.000] | 0.2689 (0.8066) | **falsified** |
| H5 | Welfare at cadence 48 is at least 90% of welfare at cadence 12 | ratio 1.056 [1.051, 1.062] | — | supported |
| H5 | …with at most 35% as many deliberations (manipulation check) | ratio 0.484 [0.482, 0.486] | — | **not supported** |
| H6a | Positive control: a charter written by the designers raises survival | −0.009 [−0.054, 0.037] | 0.7095 (0.8066) | **falsified** |
| H6b | Institutions found by non-LLM search change survival (no sign predicted) | 0.021 [−0.026, 0.068] | 0.3954 (0.8066) | reported |

What may and may not be said:

- **H6a failed, so nothing here shows that agreements help.** The protocol registered a designers' charter
  as the positive control for exactly this reason. With the control failed, "institutional affordances are
  materially useful in this world" is not established, and every claim at ladder level E5 is moot until the
  control or the ecology is redesigned and registered again on unseen seeds.
- **H3 is supported by its registered rule** (the interval excludes zero) and its family-adjusted p is 0.056.
  Both are reported; a reader who prefers the adjusted test should call it unresolved.
- **H4 is falsified by a ceiling.** Survival after the blight was 0.998–0.999 in both arms: the shock killed
  almost nobody, as the pilot had warned. The registered claim fails; the design did not test it well.
- **H5's first clause holds and its second does not.** Welfare did not fall with a slower clock (it rose by
  about 6%), but deliberations fell only to 48%, not to the 35% the protocol required as proof that the
  treatment bit: planners also deliberate whenever a plan runs out.
- **Descriptive, not registered:** in The Long Winter with the agents' own search, an agreement was adopted in
  every run (E2: 1.00 [1.00, 1.00]) and persisted in most (E4: 0.88 [0.75, 0.97]); with the designers'
  charter it was adopted in 0.91 of runs and persisted in none. These are counts of what the engine logged, on
  one parameterization, with baseline minds.
- All of it concerns a designed simulation with hand-written and search-based baseline minds. Nothing here is
  a finding about language models, and nothing is a claim about human societies (§1, §8).
