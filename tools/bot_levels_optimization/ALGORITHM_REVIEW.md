# Strength-model design review

This document records why the final optimizer uses one coordinate with an
adjacent-rank regime and a node regime.

## Rejected node-only floor

Plain Pikafish `bestmove` remained stronger than Tiantian Level 2 even at a
one-node search. Nodes therefore cannot span all required strengths. Continuing
to fit a node-only response below that floor would estimate an unreachable
target.

## Rejected behavior model

Earlier experiments combined nodes, MultiPV, score temperature, tail mixtures,
and lapse controls and attempted to match move distributions. Those parameters
overlapped in their effect on game strength, making the response difficult to
identify from expensive match outcomes. Tiantian's style was not itself a
product requirement, so behavior matching was removed.

## Selected model

Below the bestmove floor, expected rank is the only variable. Pikafish reports
the necessary leading candidates and the policy samples the two adjacent ranks.
At expected rank 1, the policy is exactly `MultiPV=1` bestmove. Above that point,
nodes are the only variable. The regimes meet at the same 149-node policy and
there is no discontinuity in the implemented strength coordinate.

The random choice is seeded from immutable game state. The same position in the
same game is reproducible, while different games can follow different paths.
The selector uses the deepest complete MultiPV rank set it can recover and
falls back to Pikafish's reported bestmove if ranked lines are unavailable.

## Statistical corrections

- Parameter updates occur only at cohort boundaries; a random single result
  cannot immediately reverse the search.
- Cohorts grow to reduce weak-level sampling noise and stop growing at 30.
- Bestmove levels use small probes at saturated 0% or 100% scores and spend
  additional games only near a transition.
- Color is modeled as a nuisance effect. Colors alternate, but no pair gate
  delays saving a completed game or updating sufficient evidence.
- Draws contribute 0.5 and are retained whenever Tiantian or the rules declare
  them.

The remaining high-level weakness is experimental diversity, not another
optimizer parameter. It is documented in `METHODOLOGY.md` and should be
addressed with varied openings before claiming narrow confidence intervals.
