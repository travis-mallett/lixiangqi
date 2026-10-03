package lila.relay

import chess.format.pgn.{ PgnStr, Tags }
import chess.TournamentClock
import scalalib.actor.AsyncActorSequencers
import com.github.blemale.scaffeine.LoadingCache
import scalalib.net.UserAgent

import lila.study.{ ChapterPreviewApi, MultiPgn, StudyPgnImport }
import lila.core.playerDirectory.{ Federation, Tokenize }
import lila.relay.RelayPush.*
import lila.memo.CacheApi

final class RelayPush(
    sync: RelaySync,
    api: RelayApi,
    chapterPreview: ChapterPreviewApi,
    directoryPlayers: RelayDirectoryPlayerApi,
    playerEnrich: RelayPlayerEnrich,
    irc: lila.core.irc.IrcApi
)(using Federation.Guess, Tokenize, Executor)(using scheduler: Scheduler):

  private val workQueue = AsyncActorSequencers[RelayRoundId](
    maxSize = Max(32),
    expiration = 1.minute,
    timeout = 10.seconds,
    name = "relay.push",
    lila.mon.asyncActorMonitor.full
  )

  def apply(rt: RelayRound.WithTour, pgn: PgnStr)(using Me, UserAgent): Fu[Results] =
    push(rt, pgn).addEffect(monitor(rt))

  private def push(rt: RelayRound.WithTour, pgn: PgnStr): Fu[Results] =
    cantHaveUpstream(rt.round) match
      case Some(failure) => fuccess(List(Left(failure)))
      case None =>
        val parsed = pgnToGames(pgn, rt.tour.info.clock)
        val games = parsed.collect { case Right(g) => g }.toVector
        val response: List[Either[Failure, Success]] =
          parsed.map(_.map(g => Success(g.tags, g.root.mainline.size)))

        if parsed.exists(_.isLeft) then
          fuccess(response.map:
            case Left(failure) => Left(failure)
            case Right(success) =>
              Left(
                Failure(success.tags, "No games were imported because another game contains invalid input")
              ))
        else
          rt.round.sync.delayMinusLag
            .ifTrue(games.exists(_.root.children.nonEmpty))
            .match
              case None =>
                push(rt, games)
                  .inject(response)
                  .recover:
                    case error: Exception =>
                      games.map(game => Left(Failure(game.tags, error.getMessage))).toList
              case Some(delay) =>
                scheduler.scheduleOnce(delay.value.seconds):
                  push(rt, games).logFailure(logger)
                fuccess(response)

  private def monitor(rt: RelayRound.WithTour)(results: Results)(using me: Me, ua: UserAgent): Unit =
    val client = ua.value.some
      .filter(_.startsWith("Lixiangqi Broadcaster"))
      .flatMap(_.split("as:").headOption)
      .getOrElse(ua.value)
      .trim
      .nonEmptyOption | "no-UA"
    lila.mon.relay.push(name = rt.path, user = me.username, client = client)(
      games = results.size,
      moves = results.collect { case Right(a) => a.moves }.sum,
      errors = results.count(_.isLeft)
    )

  private def push(prev: RelayRound.WithTour, rawGames: Vector[RelayGame]) =
    workQueue(prev.round.id):
      for
        rt <- api.byIdWithTour(prev.round.id).orFail(s"Relay $prev no longer available")
        _ <- cantHaveUpstream(rt.round).so(fail => fufail[Unit](fail.error))
        withPlayers = playerEnrich.enrichAndReportAmbiguous(rt)(rawGames)
        withDirectory <- directoryPlayers.enrichGames(rt)(withPlayers)
        withReplacements = rt.tour.players.fold(withDirectory)(_.parse.update(withDirectory)._1)
        games = rt.tour.teams.fold(withReplacements)(_.update(withReplacements))
        outcome <- sync
          .updateStudyChapters(rt, games)
          .map(_.asRight[Exception])
          .recover:
            case error: Exception => Left(error)
        event = outcome.fold(
          error => SyncLog.event(0, Some(error)),
          result => SyncLog.event(result.nbMoves, None)
        )
        _ <- outcome.swap.toOption.so: error =>
          api.update(rt.round)(_.withSync(_.addLog(event))).flatMap(_ => fufail[Unit](error))
        _ = if !rt.round.hasStarted && !rt.tour.official && event.hasMoves then
          irc.broadcastStart(rt.round.id, rt.fullNameNoTrans)
        allGamesFinished <- (games.nonEmpty && games.forall(_.points.isDefined)).so:
          chapterPreview.dataList(rt.round.studyId).map(_.forall(_.finished))
        round <- api.update(rt.round): r1 =>
          val r2 = r1.withSync(_.addLog(event))
          val r3 = if event.hasMoves then r2.ensureStarted.resume(rt.tour.official) else r2
          val finishedAt = allGamesFinished.option(r3.finishedAt.|(nowInstant))
          r3.copy(finishedAt = finishedAt)
        _ <- games.nonEmpty.so(api.syncTargetsOfSource(round))
      yield ()

  private val pgnCache: LoadingCache[PgnStr, Either[Failure, RelayGame]] =
    CacheApi.scaffeineNoScheduler
      .expireAfterAccess(2.minutes)
      .initialCapacity(1024)
      .maximumSize(4096)
      .build: pgn =>
        StudyPgnImport
          .result(pgn, Nil)
          .fold(err => Failure(Tags.empty, err.value).asLeft, _.asRight)
          .map(RelayGame.fromStudyImport)

  private def pgnToGames(pgnBody: PgnStr, tc: Option[TournamentClock]): List[Either[Failure, RelayGame]] =
    scala.util
      .Try {
        RelayFetch.injectTimeControl
          .in(tc)(MultiPgn.split(pgnBody, RelayFetch.maxChaptersToShow))
          .value
          .map(pgnCache.get)
      }
      .fold(error => List(Left(Failure(Tags.empty, error.getMessage))), identity)

  private def cantHaveUpstream(round: RelayRound): Option[Failure] =
    round.sync.hasUpstream.option:
      Failure(Tags.empty, "The relay has an upstream URL, and cannot be pushed to.")

object RelayPush:

  case class Failure(tags: Tags, error: String)
  case class Success(tags: Tags, moves: Int)
  type Results = List[Either[Failure, Success]]
