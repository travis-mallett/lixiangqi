# The 48 controls — engine-deliberation-3

All scalar ranges are **0–1**, nominal **0.5**, except `X07` nominal **0.75**,
`X08` nominal **0.15**, and experimental `E01`–`E08` nominal **0**. `E03` has range
**−1–1**. Nonzero experimental values require explicit experimental mode. These
are engineering reference values, not population estimates or Elo conversions.
The compiler checks all 48 keys, finite values, curriculum prerequisites and
structured dimensions. There is no additional engine-assist percentage.

`K01` is a separate normalized distribution over installed opening families for
each player (nominal uniform). `K03` assigns each installed schema `absent`,
`recognized`, `understood` or `proceduralized`. The xiangqi reference has 25 schemas;
elementary geometry and captures are proceduralized, more advanced ideas generally
understood. `S07` assigns 0–1 affinity to every installed strategic piece role
(nominal 0.5). Population generation supports correlated truncated normal scalars,
logistic-normal repertoires, role variation and prerequisite-valid curriculum
mixtures. No in-game learning changes a profile.

## Knowledge and attention

| ID  | Control                  | Implemented effect and boundary                                                                                                                                                                                                                |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K01 | Repertoire distribution  | A seeded weighted draw selects one opening family per game/side. Only that family's applicable recall bindings enter retrieval. It does not force a recalled move outside the engine quality envelope.                                         |
| K02 | Recall extent            | Admits authored continuations whose extent is within the control; recalled moves gain nomination salience. Unlisted variations do not become memorized merely by raising the control.                                                          |
| K03 | Knowledge curriculum     | Gates schema retrieval and exact relation inspection. Recognized-only knowledge cannot inspect as understood knowledge. Average mastery also participates in engine-candidate admission and quality tolerance; it never modifies NNUE weights. |
| K04 | Transfer breadth         | Near-match retrieval activation gains `2.5 × (K04 − (1 − similarity))`. Exact matches have no transfer penalty/bonus. Retrieved near-matches can nominate inappropriate ideas, which the engine then evaluates.                                |
| K05 | Retrieval accessibility  | Adds `2 × (K05 − 0.5)` to keyed logistic activation. One draw jointly controls successful access and latency; repeated reads cannot reroll. Recognition also increases admission of a surveyed candidate.                                      |
| K06 | Applicability checking   | Allows 2–12 relation inspections before coverage narrowing and contributes up to 25% of the refinement-effort factor. High values demand engine verification even when the shallow survey seems convincing.                                    |
| A01 | Defensive orientation    | Prioritizes inspections of enemy pieces and defensive move cues. It cannot suppress the full legal root at maximum discovery.                                                                                                                  |
| A02 | Quiet-resource attention | Increases nomination salience of quiet moves, especially those with recognizable defensive purpose. It is not a blanket reward for moving an advisor.                                                                                          |
| A03 | Relational coverage      | Inspection reach increases from 0.2 to 1 on normalized public geometry, and the inspection-count multiplier rises from 0.35 to 1. Distant relations therefore require greater coverage.                                                        |
| A04 | Focus persistence        | Carries a schema focus for 2–8 plies and biases subsequent retrieval, inspection order and nominations toward it. Expired focus is ignored; exact legal state is never retained incorrectly.                                                   |

## Calculation

| ID  | Control                | Implemented effect and boundary                                                                                                                                                                                                          |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | Deliberation capacity  | Node budget is `round(2048 × 2^(6C01))`: 2,048–131,072, nominal 16,384. Cognitive capacity is 24–96 units. Together with curriculum mastery it controls discovery and choice precision. Host and clock limits can stop work sooner.      |
| C02 | Own candidate breadth  | Requests 2–6 root MultiPV lines and authored nominees, reduced under urgency. More alternatives share the same node budget, so this is not a monotonic Elo knob.                                                                         |
| C03 | Opponent reply breadth | Requests 1–4 explicit reply PVs and reserves up to 12% of the total nodes for their survey. At zero the extra survey is skipped. Pikafish still searches adversarial replies internally.                                                 |
| C04 | Verification effort    | Forces refinement at values ≥0.8 and contributes up to 55% of its effort factor. Combined effort is `clamp(0.2 + .55C04 + .25K06 + noticed reaction, .2, 1)`.                                                                            |
| C05 | Branch retention       | Retains 2–16 units of PV detail. Longer lines incur reconstruction cost; up to four exact forecasts can be retained, limited by that capacity. This is human memory, not the engine hash size.                                           |
| C06 | Forcing fluency        | Reduces effort/time for successfully retrieved proceduralized forcing chunks by up to 45%. A capture without the relevant procedural knowledge gets no such benefit. The compiler requires a proceduralized forcing schema when enabled. |

The derived mastery average uses 0, .25, .65 and 1 for the four `K03` levels.
Discovery is `C01 × (.25 + .75 × mastery)`. Maximum discovery keeps the entire legal
root in verification; lower discovery samples access to surveyed engine ideas,
combined with knowledge nominees. Skill is `sqrt(C01 × mastery)`, and the quality
envelope is `.08 + 1.5 × (1 − skill)^2` engine decision units. For standard xiangqi
those units are pawns/100 cp; other engines must define a comparable normalized
scale. The advanced reference has discovery 1 and an 8 cp envelope.

## Style and plans

Every style term is bounded inside the quality envelope. Forced outcome ordering
is separate from finite evaluation. Stronger-profile style diversity comes from
credible alternatives, not deliberate large losses.

| ID  | Control                   | Implemented effect and boundary                                                                                                                                                |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S01 | Attack and initiative     | Weights recognized initiative and activity and increases forcing-cue activation. Geometry remains descriptive; searched engine utility remains the basis of quality.           |
| S02 | Material security         | Weights the subjective material/activity tradeoff and material-gain nomination cues. A superficially profitable capture cannot bypass a searched refutation.                   |
| S03 | Downside aversion         | Sets risk weight 0–.75 on a continuous lower-tail mean versus expected examined reply outcomes, and penalizes line uncertainty. Unknown replies retain explicit downside mass. |
| S04 | Complexity preference     | Favors or avoids recognized unresolved activity around the .5 midpoint. Unknown tactical complexity is not magically recognized.                                               |
| S05 | Simplification preference | Favors or avoids recognized exchanges and reduced material/decision burden. Close engine-valued alternatives are required.                                                     |
| S06 | Prophylactic preference   | Weights inspected prevention, shelter and safety features. Unnoticed relations do not create a defensive style bonus.                                                          |
| S07 | Piece-role affinity       | Weights credible inspected activity for installed strategic roles. Merely owning an inactive favorite piece gives no bonus.                                                    |
| S08 | Draw preference           | Shifts preference for a search-recognized draw within the quality envelope. It cannot turn a known loss into a draw or adjudicate the game.                                    |
| P01 | Goal persistence          | Favors retrieval/nomination of the current plan, its progress and continuation; tolerates up to 3–9 stalls. Physically invalid or expired plans are dropped.                   |
| P02 | Disconfirmation response  | Sets the probability of abandoning a plan when no engine-credible candidate supports it. A disconfirmed goal cannot immediately reinstall itself in the same episode.          |
| P03 | Second-idea tendency      | Promotes candidate nominations from a different schema/role family as the shortlist grows. It does not generate arbitrary random moves.                                        |
| P04 | Expectation concentration | Raises/lower the concentration of engine-informed opponent-response weights. The unexamined probability reserve is preserved.                                                  |

## Time and advanced psychology

| ID  | Control                    | Implemented effect and boundary                                                                                                                                                                                         |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | Clock reserve              | Reserves 2–20% of reference time, bounded by spendable clock, and changes the per-turn share. Future increment never counts as currently available time.                                                                |
| T02 | Deliberation persistence   | Raises the uncertainty threshold that requests verification, future time allocation and uncertainty-related thinking time. It cannot exceed the hard host/clock envelope.                                               |
| T03 | Familiarity speed          | Reduces familiar-event time by up to 50%; the same retrieval/mastery result governs recognition and timing.                                                                                                             |
| T04 | Anticipatory preparation   | Converts real observed opponent waiting into rehearsed engine forecasts, one per `750/T04` ms, bounded by retained forecasts. No added engine call or credit from imagined future waiting.                              |
| X01 | Subjective certainty bias  | Shifts confidence for stopping by up to ±.25 and reported confidence by ±.15. It never changes engine scores.                                                                                                           |
| X02 | Rechecking tendency        | Charges up to four nonproductive recheck units when alternatives exist. It does not manufacture extra evidence or engine work.                                                                                          |
| X03 | Urgency onset              | Moves the logistic clock-demand threshold from 1.5 to 7.5, with carried hysteresis. No universal fixed-second panic threshold.                                                                                          |
| X04 | Urgent attention narrowing | Reduces optional breadth and node budget by up to 65% as urgency rises. Full root eligibility for advanced verification is preserved.                                                                                   |
| X05 | Expected resourcefulness   | Sharpens reply weights toward moves benefiting the actual responding player, adjusts unknown downside and discounts practical-trap appeal. It never reads an opponent's hidden profile.                                 |
| X06 | Practical-trap preference  | Gives a small preference only when a surveyed reply is tempting, a subsequent refutation is legal/recognized, and its engine utility supports the trap.                                                                 |
| X07 | Resistance and resignation | Raises tolerated disadvantage; resignation also requires sufficient searched depth/confidence, ply >12, and no immediate check. Values ≥.98 disable voluntary resignation.                                              |
| X08 | Conditional premoves       | Permits a prepared intended response only when exact observation/history, dependencies and legality match. Fresh analysis still confirms it; submission can be as short as 25 ms but never precedes actual computation. |

## Experimental, off by default

| ID  | Control                  | Implemented effect and boundary                                                                                                                                                                                           |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01 | Sustained-effort fatigue | Accepted decisions accumulate bounded fatigue proportional to effort. It raises operation time and can reduce subsequent node budgets by up to 25%.                                                                       |
| E02 | Distraction episodes     | A seeded chance up to 12% introduces a bounded 250–2,750 ms nonproductive interruption, subject to remaining clock.                                                                                                       |
| E03 | Post-setback response    | Signed response to a noticed decline in engine-informed subjective value. Positive values promote slower verification; negative values rush and reduce subsequent effort. The first position is not treated as a setback. |
| E04 | Recovery dynamics        | Exponential decay of temporary fatigue/reaction/complacency with half-life 300–30 seconds. It never changes learned knowledge or identity.                                                                                |
| E05 | Success complacency      | A noticed improvement increases complacency, reducing later checking resources by up to 15%. It requires prior perceived evidence.                                                                                        |
| E06 | State-dependent risk     | Shifts the risk weight by up to ±.2 with perceived advantage/disadvantage, clamped to 0–.95.                                                                                                                              |
| E07 | Accepted input slips     | At most 1.5% probability of a legal geometrically adjacent input. Intended and executed actions are logged; unmatched plans/forecasts are discarded. This opt-in mechanism can leave the quality envelope.                |
| E08 | Session variability      | Seeds one stable session offset for retrieval and timing. Cross-game carryover requires the same profile/session identity and recovers with elapsed time.                                                                 |

A parameter can be inactive in a position without being unimplemented: no known
trap means no `X06` bonus, no previous setback means no `E03` reaction, and no
matching forecast means no `X08` premove. The lab records interventions and their
contexts; an observed difference is not proof of human validity, monotonic playing
strength or population calibration. Engine node counts are stable targets, while
wall deadlines and runtime scheduling can change completed depth across devices.
