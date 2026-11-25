package lila.game

import lila.core.LightUser
import lila.core.game.{ AiLevel, Game, Player, Pov }
import lila.core.rank.RankCode.*
import lila.game.Player.nameSplit

object Namer extends lila.core.game.Namer:

  /** Stable recorded identities shared by game exports and replay metadata. */
  def recordedPlayerText(player: Player, user: Option[LightUser], banqi: Boolean = false): String =
    player.aiLevel.fold(
      user.fold(
        player.nameSplit.map(_._1.value).orElse(player.name.map(_.value)).getOrElse(UserName.anonymous.value)
      )(_.name.value)
    )(AiLevel.displayName(_, banqi))

  def playerTextBlocking(pov: Pov, withRating: Boolean = false)(using
      lightUser: LightUser.GetterSync
  ): String =
    playerTextUser(pov, pov.player.userId.flatMap(lightUser), withRating)

  def playerText(pov: Pov, withRating: Boolean = false)(using lightUser: LightUser.Getter): Fu[String] =
    pov.player.userId
      .so(lightUser)
      .dmap:
        playerTextUser(pov, _, withRating)

  private def playerTextUser(pov: Pov, user: Option[LightUser], withRating: Boolean): String =
    val player = pov.player
    player.aiLevel match
      case Some(level) => AiLevel.displayName(level, pov.game.isBanqi)
      case None =>
        user.fold(player.name.fold("Anon.")(_.value)): u =>
          rankString(player)
            .ifTrue(withRating)
            .fold(u.titleName): rating =>
              s"${u.titleName} ($rating)"

  def gameVsTextBlocking(game: Game, withRatings: Boolean = false)(using
      lightUser: LightUser.GetterSync
  ): String =
    s"${playerTextBlocking(game.pov(chess.White), withRatings)} - ${playerTextBlocking(game.pov(chess.Black), withRatings)}"

  def gameVsText(game: Game, withRatings: Boolean = false)(using lightUser: LightUser.Getter): Fu[String] =
    game.whitePlayer.userId.so(lightUser).zip(game.blackPlayer.userId.so(lightUser)).dmap { (wu, bu) =>
      s"${playerTextUser(game.pov(chess.White), wu, withRatings)} - ${playerTextUser(game.pov(chess.Black), bu, withRatings)}"
    }

  def rankString(p: Player): Option[String] = p.rank.flatMap(_.publicCode).map(_.value)
