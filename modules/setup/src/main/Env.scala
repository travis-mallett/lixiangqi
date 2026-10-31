package lila.setup

import com.softwaremill.macwire.*
import com.softwaremill.tagging.*

import lila.common.Bus
import lila.core.config.CollName

@Module
final class Env(
    gameRepo: lila.core.game.GameRepo,
    userApi: lila.core.user.UserApi,
    onStart: lila.core.game.OnStart,
    gameApi: lila.core.game.GameApi,
    yoloDb: lila.db.AsyncDb @@ lila.db.YoloDb
)(using Executor, lila.core.game.IdGenerator, lila.core.game.NewPlayer):

  val forms = SetupForm

  val setupForm: lila.core.setup.SetupForm = SetupForm.api

  val processor = wire[Processor]

  lazy val aiStats = AiStatsApi(yoloDb(CollName("ai_challenge_stats")))
  lazy val kidsBots = KidsBots(yoloDb(CollName("kids_bot_games")), processor, gameRepo)

  Bus.sub[lila.core.game.FinishGame]: finish =>
    kidsBots
      .record(finish)
      .addFailureEffect: error =>
        lila.log("kidsBots").error(s"record game ${finish.game.id}", error)
    aiStats
      .record(finish)
      .addFailureEffect: error =>
        lila.log("aiStats").error(s"record game ${finish.game.id}", error)

  Bus.sub[lila.core.user.UserDelete]: deleted =>
    kidsBots
      .delete(deleted.id)
      .addFailureEffect: error =>
        lila.log("kidsBots").error(s"delete user ${deleted.id}", error)
    aiStats
      .delete(deleted.id)
      .addFailureEffect: error =>
        lila.log("aiStats").error(s"delete user ${deleted.id}", error)
