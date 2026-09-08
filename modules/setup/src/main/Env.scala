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

  Bus.sub[lila.core.game.FinishGame]: finish =>
    aiStats
      .record(finish)
      .addFailureEffect: error =>
        lila.log("aiStats").error(s"record game ${finish.game.id}", error)

  Bus.sub[lila.core.user.UserDelete]: deleted =>
    aiStats
      .delete(deleted.id)
      .addFailureEffect: error =>
        lila.log("aiStats").error(s"delete user ${deleted.id}", error)
