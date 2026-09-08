package lila.xiangqi.adjudication

import lila.xiangqi.Xiangqi.*

/** The extension point for future, edition-specific national and WXF adjudicators.
  *
  * `initial` receives a board-derived state with no played history. `afterMove` receives a board-legal
  * transition permitted by the previous policy state, and the complete immutable game before that move.
  * Policies preserve board mate/stalemate results and board coordinates. They may narrow `legalMoves`, attach
  * facts/counters, or declare an ending; a restricted move list is not evidence of checkmate. Each returned
  * snapshot must contain the policy state needed to resume play or restore a takeback. A future policy must
  * define its own classification semantics rather than reuse Tiantian chase facts merely because their data
  * shape is convenient.
  */
trait AdjudicationPolicy:
  def initial(state: State): State
  def afterMove(game: Game, move: MoveResult): State
