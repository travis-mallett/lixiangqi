package lila.round

import chess.Color

import lila.core.game.Player

object RoundGame:

  extension (g: Game)

    def playableBy(p: Player): Boolean = g.playable && p == g.player
    def playableBy(c: Color): Boolean = g.playable && g.turnOf(c)
    def playableByAi: Boolean = g.playable && g.player.isAi

    def mobilePushable: Boolean = g.isCorrespondence && g.playable && g.nonAi
    def alarmable: Boolean = g.hasCorrespondenceClock && g.playable && g.nonAi

    def hasChat = !g.isTournament && !g.isSimul && !g.isSwiss && g.nonAi

    def moretimeable(color: Color) =
      g.playable && g.canTakebackOrAddTime && !g.hasRule(_.noGiveTime) && {
        g.clock.exists(_.moretimeable(color)) || g.correspondenceClock.exists(_.moretimeable(color))
      }
    def forceDrawable = g.playable && g.nonAi && !g.abortable && !g.isSwiss && !g.hasRule(_.noClaimWin)

    def isSwitchable = g.nonAi && (g.isCorrespondence || g.isSimul)

    def secondsSinceCreation = (nowSeconds - g.createdAt.toSeconds).toInt

    def justCreated = g.secondsSinceCreation < 2

  def cannotLose(p: Pov) =
    p.game.position.insufficient:
      if p.color == chess.White then lila.xiangqi.Xiangqi.Side.Black
      else lila.xiangqi.Xiangqi.Side.Red
