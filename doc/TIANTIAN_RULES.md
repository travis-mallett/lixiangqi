# Tiantian adjudication

New playable games use `tiantian-v1`. Custom friend/AI games, API challenges
(including open challenges), and tournaments may explicitly select
`unrestricted-v1`. The latter preserves the previous board-only adjudication;
it is not a national or WXF implementation. Unknown identifiers are rejected.
Public pools always use Tiantian. A ruleset is separate from the clock, rank
track, board variant, and `GameRule` interaction flags.

## Sources and interpretation

The controlling source is the user's screenshot of 天天象棋 → 象棋玩法 →
天天象棋棋规, provided September 5, 2026. Its six draw provisions and four
forced-variation provisions take precedence over older English translations.
That screenshot is not archived in this checkout, so its exact wording cannot
currently be audited here. The limits below record the implemented interpretation;
they are not independent proof of exact current-app parity.

The Chinese game report [棋软大赛惊现长将六军认负，马象输炮兵光帅，越南冠军哭了！](https://www.a-site.cn/article/1828702.html)
(王子棋苑, April 24, 2020) describes six horse checks, the system prohibiting
further checking, and the player subsequently resigning. This supports a
restriction on continued checking rather than an automatic loss on check six.
It does not establish the app's behavior when all continuations are forbidden.
The project owner explicitly selected: reject forbidden continuations without
stopping the clock; lose immediately if no permitted continuation remains.

The screenshot does not give a complete definition of chase. This implementation
uses newly created legal capture threats with the usual Asian-style exemptions:
general/soldier attackers, uncrossed soldier targets, mutual same-role exchanges,
and protected targets (except a horse/cannon threatening a chariot). Protection
means a legal recapture after the hypothetical capture, so pins and cannon
screens matter. Threats from newly uncovered pieces count. Identity follows the
physical piece, not its type or current square. This operational definition is
documented for comparison against additional Tiantian app examples; it is not
a claim that Tencent's unpublished implementation has been reproduced.

## Implemented limits

- Neither side has a chariot, horse, cannon, or soldier: automatic draw.
- A position with the same side to move occurs five times across a sequence
  without checks, chases, responses to those threats, or captures: automatic draw.
- Both players check on six successive turns of their own: automatic draw.
- Both chase the same opposing physical piece on six successive turns: draw.
- 120 counted non-capturing plies: draw. Only the first ten non-capturing checks
  by each player contribute. A capture resets the natural counter and both check
  allowances, as well as the forcing sequence.
- 400 actual played plies: draw, irrespective of captures.
- Mate/stalemate takes precedence over the two move limits.
- One-sided checking allows 6/12/18 moves by the checking side, according to
  whether one/two/three-or-more physical pieces give check. An additional checking
  piece can extend the allowance; a quiet move breaks the checking streak.
- Chasing one target allows six moves, regardless of the number of attackers.
  When the opponent is perpetually checking, the checking side must vary first.
- Alternating check/chase allows 12 moves by one attacking piece, 18 by multiple
  pieces. The next prohibited continuation is removed from the permitted move list.

Ordinary initial-FEN halfmove/fullmove fields do not manufacture unknown history.
A custom game starts its adjudication counters at zero. Raw FEN counters remain
available for notation; Tiantian's adjusted count is stored separately.

## Organization and lifecycle

`XiangqiRules` is the public transition boundary and owns shared board legality.
`adjudication/Ruleset` selects an `AdjudicationPolicy`; `TiantianRules` implements
the policy through three focused responsibilities:

- `TiantianRules.scala`: counters, draw precedence, and permitted continuations.
- `TiantianThreats.scala`: board threats, exemptions, and physical-piece facts.
- `TiantianSequences.scala`: pure checks/chases/alternation sequence limits.

The transition path is `XiangqiRules.move(Game, Uci)` → board legality → policy
`afterMove` → threat classification → draw/sequence decisions → updated snapshot.
Candidate continuations reuse one lazy pre-move threat snapshot; recapture
protection checks stop at the first legal defender, using shared king safety.

Add future edition-specific national/WXF policies here, not branches
in rooms or duplicated movement engines. Only implemented policies are selectable.
The existing persisted counters and classified facts are Tiantian-specific.
A national policy needs its own classification and, if necessary, a versioned
snapshot payload; it should share board legality without inheriting Tiantian
chase exemptions by accident. No generic rule-engine framework is needed yet.

Each native game persists a concrete ruleset. Each position snapshot stores
piece identities, natural counters, and only its last move's forcing facts.
History is therefore linear in game length, and ordinary takeback snapshot
truncation also restores adjudication. Replaying a live game's `Position` uses
its saved policy; standalone analysis/import `Position`s default to unrestricted
so historical records and analysis variations remain readable.
Imported mainlines and `Game.fromState` snapshots are explicitly unrestricted;
use `XiangqiRules.initialGame` to create a playable game with a concrete policy.

Records without a ruleset are read as unrestricted, preserving old games. Existing
started tournaments without a ruleset retain unrestricted behavior; new/unstarted
tournaments default to Tiantian. Tournament selection freezes once players join
or play starts, and each pairing copies the tournament policy into the game.
Rematches retain the original policy and reset the history.

Live JSON, bot streams, and exports identify the ruleset and ending reason. The
round UI displays required variation. Bot streams and the built-in AI receive
the server's permitted move list; Pikafish search is restricted to that list.
If Pikafish's own adjudication reports no move while the site permits moves,
the worker returns a permitted fallback. This keeps games running but does not
make engine evaluations exactly match Tiantian throughout the search tree.

The legacy server `Mate` status also represents a Xiangqi stalemate win.
Presentation must use the termination reason, not that status alone, to select
checkmate effects. Replay steps likewise require a winning checkmate; an ended
position with check can be a draw or a forced-variation loss.

The former 300-ply AI resignation is removed. A separate 600-played-ply server
resource guard remains for unrestricted games, applying equally to human/bot/AI
games, independently of a custom FEN's starting move number.

## Verification

### Coverage map

| Area                           | Coverage and deliberate scope                                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated checks                | Legal one/two/three-piece boundaries, full quiet restarts, both sides' capture resets, and a seventh cannon check that mates while a nonmating seventh check in the same position is prohibited. Pure facts cover double checks, new identities, and the three-piece cap for both colors. |
| Chase classification           | Board threats, pins, screens, protection/exchange exemptions; legal six-chase and full restart fixtures isolate the same physical target. Pure facts cover changing and overlapping target sets.                                                                                          |
| Alternating and mutual forcing | Legal single/multiple attacker 12/18 boundaries, full restart with reversed phase, and legal six-pair mutual-check/chase draws. Pure facts additionally isolate asymmetric counts and checking priority.                                                                                  |
| Draw counters and precedence   | Complete 120- and 400-ply histories with no competing draw cause, fivefold quiet repetition, last-attacker capture, and explicitly seeded counter/terminal combination tests for both colors.                                                                                             |
| Forced variation and lifecycle | Permitted-list filtering, direct rejection, replay, and rewind; exhaustion remains explicitly a supplied-move-list unit test, not a claimed natural game history.                                                                                                                         |
| Learn playback                 | All 18 canonical histories are shared with the human bench. Short scripts test every playback prefix; long scripts play every move and compare replay at selected boundaries and capture resets.                                                                                          |

See [the fixture audit](TIANTIAN_FIXTURE_AUDIT.md) for the coverage standard,
individual histories, source evidence, and remaining limits. Synthetic facts
isolate policy arithmetic; they are explicitly distinct from legal replay games.

The Xiangqi suite covers move-limit boundaries, physical piece identities,
check/chase restrictions, mutual forcing draws, material draws, terminal-move
precedence, capture resets, replay, takeback, and exhaustion of permitted moves.
Persistence tests cover old snapshots without the new fields and unknown-version
rejection. Integration tests cover setup forms, challenge creation, tournament
selection, rematches, and the AI protocol/worker's permitted-move contract.

Before the September 5 adversarial review, the full application compile, targeted Scala suites, Python worker tests,
TypeScript build, and round/lobby asset builds were checked. The tournament
ruleset tests run in isolation because existing `DuelTest` and `PlanBuilderTest`
still reference ranking/condition APIs removed by other work in this checkout;
the complete tournament test suite cannot currently compile.

See [the adversarial review](TIANTIAN_RULES_REVIEW.md) for the subsequent fixes,
review decisions, current verification, and remaining evidence gaps.
