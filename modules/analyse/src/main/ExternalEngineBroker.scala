package lila.analyse

import scala.collection.mutable
import java.security.MessageDigest
import java.nio.charset.StandardCharsets.UTF_8
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.{ Cancellable, Scheduler }
import org.apache.pekko.stream.{ Materializer, OverflowStrategy }
import org.apache.pekko.stream.scaladsl.{ Source, SourceQueueWithComplete }
import play.api.libs.json.*
import scalalib.SecureRandom

import lila.xiangqi.{ Xiangqi, XiangqiEvaluation, XiangqiRules }
import lila.xiangqi.XiangqiJson.given
import lila.xiangqi.adjudication.Ruleset

/** Bounded rendezvous between a registered private engine and its browser clients. No searches run here. */
final class ExternalEngineBroker(api: ExternalEngineApi)(using Executor, Scheduler, Materializer):
  import ExternalEngineBroker.*

  private final class Job(
      val id: String,
      val secret: String,
      val engine: ExternalEngine,
      val work: Work,
      val game: Xiangqi.Game,
      val queue: SourceQueueWithComplete[JsObject]
  ):
    var acquired = false
    var lastUpdate = 0L
    var lastDepth = 0
    var nextUpdate = 0L
    var committedUpdate = 0L
    var timer: Option[Cancellable] = None

  private val jobs = mutable.LinkedHashMap.empty[String, Job]

  def analyse(id: String, input: Request): Fu[Either[Error, Source[JsObject, NotUsed]]] =
    if !id.matches("eei_[A-Za-z0-9]{12}") || input.clientSecret.length > 128 then
      fuccess(Left(Error(403, "Invalid engine credentials")))
    else
      api
        .authenticate(id, input.clientSecret)
        .map:
          case None => Left(Error(403, "Invalid engine credentials"))
          case Some(engine) =>
            validate(input.work, engine).flatMap: (work, game) =>
              synchronized:
                jobs.values
                  .filter(j => j.engine._id == id && j.work.sessionId == work.sessionId)
                  .toList
                  .foreach(j => close(j.id))
                if jobs.size >= 512 || jobs.values.count(_.engine.userId == engine.userId) >= 8 then
                  Left(Error(429, "Too many active external engine searches"))
                else
                  val (queue, source) = Source.queue[JsObject](16, OverflowStrategy.fail).preMaterialize()
                  val job =
                    Job(SecureRandom.nextString(24), SecureRandom.nextString(32), engine, work, game, queue)
                  jobs(job.id) = job
                  job.timer = Some(
                    summon[Scheduler].scheduleOnce(30.seconds)(
                      expire(job.id, "No external engine provider acquired this search")
                    )
                  )
                  val watched = source.watchTermination(): (_, done) =>
                    done.onComplete(_ => close(job.id))
                    NotUsed
                  Right(watched)

  def acquire(providerSecret: String): Either[Error, Option[JsObject]] =
    if providerSecret.length < 16 || providerSecret.length > 1024 then
      Left(Error(403, "Invalid provider credentials"))
    else
      synchronized:
        val selector = ExternalEngine.selector(providerSecret)
        Right(
          jobs.values
            .find(j => !j.acquired && sameSecret(j.engine.providerSelector, selector))
            .map: job =>
              job.acquired = true
              job.timer.foreach(_.cancel())
              job.timer = Some(
                summon[Scheduler].scheduleOnce(20.minutes)(expire(job.id, "External engine search timed out"))
              )
              Json.obj(
                "id" -> job.id,
                "secret" -> job.secret,
                "work" -> (Json.toJson(job.work).as[JsObject] ++ Json
                  .obj("legalMoves" -> job.game.state.legalMoves)),
                "engine" -> Json.obj(
                  "id" -> job.engine._id,
                  "name" -> job.engine.name,
                  "providerData" -> job.engine.providerData
                )
              )
        )

  def submit(id: String, update: Update): Either[Error, Unit] =
    val selected = synchronized:
      jobs
        .get(id)
        .filter(j => j.acquired && sameSecret(j.secret, update.secret))
        .toRight(Error(404, "External engine search is no longer active"))
        .flatMap: job =>
          val now = System.nanoTime()
          if update.error.exists(
              _.length > 1024
            ) || (update.error.isDefined && (!update.done || update.analysis.isDefined))
          then Left(Error(400, "Invalid provider failure"))
          else if update.analysis.exists(_.depth < job.lastDepth) then
            Left(Error(400, "Out-of-order engine analysis"))
          else if !update.done && now - job.lastUpdate < 200_000_000L then
            Left(Error(429, "Engine updates must be at least 200ms apart"))
          else
            job.lastUpdate = now
            job.nextUpdate += 1
            Right(job -> job.nextUpdate)
    selected.flatMap: (job, sequence) =>
      update.analysis
        .map(validateAnalysis(_, job.game, job.work.multiPv))
        .getOrElse(Right(()))
        .flatMap: _ =>
          synchronized:
            if !jobs.get(id).contains(job) then Left(Error(404, "External engine search is no longer active"))
            else if sequence <= job.committedUpdate || update.analysis.exists(_.depth < job.lastDepth) then
              Left(Error(400, "Out-of-order engine analysis"))
            else
              job.committedUpdate = sequence
              update.error.foreach(message => job.queue.offer(Json.obj("error" -> message)))
              update.analysis.foreach: analysis =>
                job.lastDepth = analysis.depth
                job.queue.offer(Json.toJson(analysis).as[JsObject]).failed.foreach(_ => close(id))
              if update.done then close(id)
              Right(())

  private def expire(id: String, message: String): Unit = synchronized:
    jobs
      .get(id)
      .foreach: job =>
        job.queue.offer(Json.obj("error" -> message)).onComplete(_ => close(id))

  private def close(id: String): Unit = synchronized:
    jobs
      .remove(id)
      .foreach: job =>
        job.timer.foreach(_.cancel())
        job.queue.complete()

object ExternalEngineBroker:
  case class Error(status: Int, message: String)
  case class Work(
      sessionId: String,
      threads: Int,
      hash: Int,
      multiPv: Int,
      initialFen: String,
      moves: Vector[Xiangqi.Uci],
      ruleset: Ruleset,
      depth: Option[Int],
      nodes: Option[Long],
      movetime: Option[Int]
  )
  case class Request(clientSecret: String, work: Work)
  case class Pv(moves: List[Xiangqi.Uci], cp: Option[Int], mate: Option[Int])
  case class Analysis(time: Long, depth: Int, nodes: Long, pvs: List[Pv])
  case class Update(secret: String, analysis: Option[Analysis], done: Boolean, error: Option[String])
  given OFormat[Work] = Json.format
  given Reads[Request] = Json.reads
  given OFormat[Pv] = Json.format
  given OFormat[Analysis] = Json.format
  given Reads[Update] = Json.reads

  private def sameSecret(a: String, b: String) = MessageDigest.isEqual(a.getBytes(UTF_8), b.getBytes(UTF_8))

  private[analyse] def validate(work: Work, engine: ExternalEngine): Either[Error, (Work, Xiangqi.Game)] =
    val budget = List(work.depth, work.nodes, work.movetime).count(_.isDefined)
    for
      _ <- Either.cond(
        work.sessionId.matches("[A-Za-z0-9_-]{1,128}") && work.threads > 0 && work.hash > 0 &&
          work.multiPv >= 1 && work.multiPv <= 10 && budget == 1 &&
          work.depth.forall(n => n > 0 && n <= 255) && work.nodes.forall(n =>
            n > 0 && n <= 1_000_000_000_000L
          ) &&
          work.movetime.forall(n => n > 0 && n <= 1_200_000),
        (),
        Error(400, "Invalid native engine search limits")
      )
      game <- XiangqiEvaluation
        .game(Xiangqi.Position(work.initialFen, work.moves, work.ruleset))
        .left
        .map(Error(400, _))
      _ <- Either.cond(!game.state.ended, (), Error(400, "This Xiangqi position is terminal"))
    yield work.copy(
      threads = work.threads.min(engine.maxThreads),
      hash = work.hash.min(engine.maxHash),
      initialFen = game.states.head.fen
    ) -> game

  private[analyse] def validateAnalysis(
      analysis: Analysis,
      game: Xiangqi.Game,
      multiPv: Int
  ): Either[Error, Unit] =
    if analysis.time < 0 || analysis.nodes < 0 || analysis.depth < 1 || analysis.depth > 255 ||
      analysis.pvs.isEmpty || analysis.pvs.size > multiPv || analysis.pvs
        .map(_.moves.headOption)
        .distinct
        .size != analysis.pvs.size
    then Left(Error(400, "Invalid external engine analysis"))
    else
      analysis.pvs.foldLeft[Either[Error, Unit]](Right(())): (result, pv) =>
        result.flatMap: _ =>
          if pv.cp.isDefined == pv.mate.isDefined || pv.moves.isEmpty || pv.cp.exists(n =>
              math.abs(n.toLong) > 1_000_000
            ) || pv.mate.exists(n => n == 0 || math.abs(n.toLong) > 32767)
          then Left(Error(400, "Invalid external engine score or variation"))
          else XiangqiRules.variation(game, pv.moves.toVector).map(_ => ()).left.map(Error(400, _))
