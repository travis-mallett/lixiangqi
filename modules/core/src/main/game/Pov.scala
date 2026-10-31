package lila.core
package game

import _root_.chess.Color
import scalalib.model.Seconds

import lila.core.id.GameId
import lila.core.userId.UserIdOf

case class Pov(game: Game, color: Color):

  export game.id as gameId

  def player = game.player(color)

  def playerId = player.id

  def fullId = game.fullIdOf(color)

  def opponent = game.player(!color)

  def flip = copy(color = !color)

  def unary_! = flip

  def ref = PovRef(game.id, color)

  def withGame(g: Game) = copy(game = g)
  def withColor(c: Color) = copy(color = c)

  lazy val isMyTurn = game.started && game.playable && game.turnColor == color

  lazy val remainingSeconds: Option[Seconds] =
    game
      .effectiveClockRemaining(color)
      .map(_.roundSeconds)
      .orElse:
        Seconds.from(game.playableCorrespondenceClock.map(_.remainingTime(color).toInt))

  def hasMoved = game.playerHasMoved(color)

  def moves = game.playerMoves(color)

  def win = game.wonBy(color)

  def forecastable = game.forecastable && game.turnColor != color

  def mightClaimWin = game.forceResignable && !isMyTurn

  def sideAndStart = SideAndStart(color, game.startedAtPly)

  override def toString = ref.toString

object Pov:
  /** A full id is a player capability only for a guest human. Registered sides require their account. */
  def forPlayer(
      game: Game,
      id: lila.core.id.GameAnyId,
      userId: Option[lila.core.userId.UserId]
  ): Option[Pov] =
    Option
      .when(id.gameId == game.id):
        userId
          .flatMap(Pov(game, _))
          .orElse:
            id.playerId
              .flatMap(game.playerById)
              .filter(player => !player.hasUser && !player.isAi)
              .map(Pov(game, _))
      .flatten

  def naturalOrientation(game: Game): Pov = Pov(game, game.naturalOrientation)
  def apply(game: Game, player: Player): Pov = Pov(game, player.color)
  def apply[U: UserIdOf](game: Game, user: U): Option[Pov] =
    game.player(user).map { apply(game, _) }

case class PovRef(gameId: GameId, color: Color):
  def unary_! = PovRef(gameId, !color)
  override def toString = s"$gameId/${color.name}"
