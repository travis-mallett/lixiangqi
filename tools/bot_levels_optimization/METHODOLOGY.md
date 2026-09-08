# Computer-level calibration methodology

## Objective

Lixiangqi's computer levels were calibrated by playing fixed Pikafish policies
against selected Tiantian levels. The target was a color-balanced match score
of 50%: win 1, draw 0.5, loss 0. A declared draw is therefore direct evidence
of comparable game strength, not an automation error.

The calibration matches playing strength only. It does not attempt to imitate
Tiantian's move distribution, style, or mistakes.

## Final policy design

The lowest node budget at which `MultiPV=1` could match a reference opponent
was 149 nodes against Tiantian Level 7. That observation anchors both sides of
the strength model:

1. For Tiantian levels below 7, nodes remain fixed at 149. Pikafish reports its
   top two moves and the policy samples adjacent ranks to achieve an expected
   rank between 1 and 2.
2. At Tiantian Level 7, expected rank reaches exactly 1 and the engine always
   plays `bestmove`.
3. For Tiantian levels above 7, `MultiPV=1` and expected rank 1 remain fixed;
   only the node budget changes.

Tiantian Level 2 was calibrated directly at expected rank
`1.2109662691040561`. Tiantian Level 7 is the 149-node rank-1 boundary. Levels
3, 4, and 5 are deliberately pure interpolation between those anchors. The
Level 5-to-7 gap counts as two equal increments, giving five equal coordinate
steps from Level 2 to Level 7. Later exploratory games at Level 3 are not used
as release evidence and do not override this interpolation.

## Release profiles

The public site calls these levels 1 through 9. Tiantian names are retained
only here as calibration provenance.

| Site level | Reference level |     Nodes | MultiPV | Expected rank | Rank selection                   |
| ---------: | --------------: | --------: | ------: | ------------: | -------------------------------- |
|          1 |               2 |       149 |       2 |  1.2109662691 | rank 1: 78.903%; rank 2: 21.097% |
|          2 |               3 |       149 |       2 |  1.1654821783 | rank 1: 83.452%; rank 2: 16.548% |
|          3 |               4 |       149 |       2 |  1.1217064774 | rank 1: 87.829%; rank 2: 12.171% |
|          4 |               5 |       149 |       2 |  1.0795749989 | rank 1: 92.043%; rank 2: 7.957%  |
|          5 |               7 |       149 |       1 |           1.0 | bestmove                         |
|          6 |               9 |     7,849 |       1 |           1.0 | bestmove                         |
|          7 |              12 |    24,389 |       1 |           1.0 | bestmove                         |
|          8 |              18 |   235,500 |       1 |           1.0 | bestmove                         |
|          9 |              25 | 3,318,000 |       1 |           1.0 | bestmove                         |

These values are the release profiles and the optimizer's evidence-informed
defaults. Raw games and generated exports remain local research artifacts and
are not source-controlled.

## Final evidence snapshot

The following counts are the games played at the exact release policy, not all
historical trials at each reference level. They preserve the evidentiary basis
without committing the raw database.

| Reference level | Games |    W-D-L | Match score | Release basis                                       |
| --------------: | ----: | -------: | ----------: | --------------------------------------------------- |
|               2 |   159 | 69-10-80 |       46.5% | directly calibrated anchor                          |
|               3 |     6 |    4-0-2 |       66.7% | interpolation; exploratory games do not override it |
|               4 |     0 |        - |           - | interpolation only                                  |
|               5 |     0 |        - |           - | interpolation only                                  |
|               7 |    42 |  21-0-21 |       50.0% | directly calibrated boundary                        |
|               9 |    60 |  30-0-30 |       50.0% | directly calibrated nodes                           |
|              12 |    12 |    6-0-6 |       50.0% | directly calibrated nodes                           |
|              18 |    25 |   0-25-0 |       50.0% | directly calibrated nodes                           |
|              25 |    20 |   4-16-0 |       60.0% | extrapolated candidate with 80% draws               |

The Level 25 score retains a modest positive bias, so 3,318,000 nodes should be
read as the best available release candidate rather than a precisely identified
parity point. Its high draw rate is strong evidence that it is in the intended
strength neighborhood. The deterministic 50% rows require the limitation below:
their nominal sample sizes overstate independent information.

## Optimizer

The optimizer maps every policy to one normalized monotone strength coordinate.
Below the rank-1 boundary it maps the coordinate geometrically to expected
rank. Above the boundary it maps it geometrically to nodes. Consequently a
search can cross the boundary without jointly tuning rank and nodes.

Stochastic adjacent-rank profiles remain fixed within non-overlapping cohorts.
The cohort sizes grow to reduce move-sampling noise and are capped at 30 games.
Deterministic bestmove profiles use short rail probes: saturated all-win or
all-loss settings can be rejected quickly, while a mixed result or draw causes
more games at that exact setting. Red and Black alternate, but completion of a
color pair is not a statistical or persistence requirement.

A monotone outcome model incorporates color as a nuisance term and estimates
the color-balanced 50% point. The GUI reports exact-policy evidence, uncertainty,
the 45-55% practical target band, the current bracket, and the recent parameter
trajectory. Completed games are committed durably before optimization state is
advanced.

## Known limitation

At the deterministic levels, several apparent 50% results came from one color
winning every repeated game and the other color losing every repeated game.
With a fixed position, opponent, engine, and policy, these are repeated samples
of only two deterministic trajectories, not independent evidence that the
level would score 50% across diverse human play. Alternating colors correctly
measures that narrow match setup, but it does not manufacture game diversity.

This limitation does not invalidate the node ordering, but it makes the exact
high-level parity estimates less certain than the raw game counts suggest.

## Future work

1. Add a Xiangqi opening book. Even low-level players usually know several
   sound opening moves. A book can sample master opening continuations for a
   level-dependent number of plies, then transition to the calibrated engine
   policy. This would improve opening quality and create diverse games. Every
   affected level must be recalibrated because book play changes total strength.
2. Re-evaluate deterministic high levels over a suite of opening positions.
   An opening book is the preferred source of diversity. A secondary option is
   retaining `MultiPV=2` or 3 at all levels with a very small non-bestmove
   probability, although that changes the deliberately plain bestmove policy.
3. Re-run calibration when changing the Pikafish binary, search options, thread
   count, node semantics, or move-selection implementation. Fixed nodes reduce
   hardware dependence, but they do not make different engine versions
   strength-equivalent.
