package lila.fishnet

import chess.Ply
import chess.eval.Eval.Cp
import chess.variant.Standard

import java.time.Instant

import lila.fishnet.JsonApi.Request.Evaluation
import lila.fishnet.JsonApi.Request.Evaluation.EvalOrSkip
import lila.mon.extensions.*
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final class AnalysisBuilderTest extends munit.FunSuite:

  private given Executor = scala.concurrent.ExecutionContextOpportunistic

  test("builds native analysis info from Xiangqi Fishnet evaluations"):
    val actualMoves = List("a4a5", "a7a6").map(Xiangqi.Uci.unsafe)
    val alternative = Xiangqi.Uci.unsafe("b1c3")
    val work = Work.Analysis(
      _id = Work.Id("workid"),
      sender = Work.Sender(UserId("user"), None, mod = false, system = false),
      game = Work.Game(
        id = "TaHSAsYD",
        initialFen = None,
        studyId = None,
        variant = Standard,
        moves = actualMoves.map(_.value).mkString(" ")
      ),
      startPly = Ply.initial,
      tries = 0,
      lastTryByKey = None,
      acquired = None,
      skipPositions = Nil,
      createdAt = Instant.ofEpochMilli(1684055956),
      origin = Work.Origin.manualRequest.some
    )
    val evaluations = List(
      evaluated(cp = 20, pv = alternative :: Nil),
      evaluated(cp = 35, pv = actualMoves(1) :: Nil),
      evaluated(cp = 10, pv = Nil)
    )

    val analysis =
      AnalysisBuilder(FishnetEvalCache.mock)
        .apply(Client.offline, work, evaluations)
        .await(1.second, "build Xiangqi analysis")

    assertEquals(analysis.infos.map(_.ply), List(Ply(1), Ply(2)))
    assertEquals(analysis.infos.head.best, Some(alternative.value))
    assertEquals(
      analysis.infos.head.variation.map(_.value),
      List(XiangqiRules.wxf(Xiangqi.startFen, alternative).toOption.get)
    )
    assertEquals(analysis.infos.head.cp, Some(Cp(-35)))
    assertEquals(analysis.infos(1).cp, Some(Cp(10)))

  private def evaluated(cp: Int, pv: List[Xiangqi.Uci]) =
    EvalOrSkip.Evaluated(
      Evaluation(
        pv = pv,
        score = Evaluation.Score(cp = Some(Cp(cp)), mate = None),
        time = Some(10),
        nodes = Some(1_000),
        nps = Some(100_000),
        depth = None
      )
    )
