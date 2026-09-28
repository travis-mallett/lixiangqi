package controllers

import play.api.libs.json.*
import play.api.mvc.Cookie
import lila.app.{ *, given }
import lila.common.HTTPRequest
import lila.traffic.{ ClientBatch, TrafficFilter }

final class Traffic(env: Env) extends LilaController(env):
  private val intakeLimit = lila.memo.RateLimit[String](1200, 1.minute, "traffic.ingest", log = false)(using
    lila.core.config.RateLimit.Yes
  )
  private val globalLimit = lila.memo.RateLimit[String](6000, 1.minute, "traffic.global", log = false)(using
    lila.core.config.RateLimit.Yes
  )

  def index = Secure(_.ViewTrafficStats) { _ ?=> _ ?=> Ok.page(views.traffic.index).map(_.noCache) }

  private def filter(using Context): Either[String, TrafficFilter] =
    TrafficFilter.read(
      ctx.req.queryString.flatMap((key, values) => values.headOption.map(key -> _)),
      nowInstant
    )

  private def report(using Context): Fu[JsObject] =
    filter.fold(error => fufail(error), env.traffic.query.report)

  def searches = Secure(_.ViewTrafficStats) { _ ?=> _ ?=>
    env.traffic.store.reportsReady
      .flatMap(_ =>
        filter.fold(
          error => fufail[JsObject](error),
          f => env.traffic.store.limitedReport(env.traffic.cohorts.searches(f))
        )
      )
      .map(value => Ok(value).noCache)
      .recover { case _ =>
        BadRequest(Json.obj("error" -> "Report query exceeds its budget or is unavailable"))
      }
  }
  def returns = Secure(_.ViewTrafficStats) { _ ?=> _ ?=>
    env.traffic.store.reportsReady
      .flatMap(_ =>
        filter.fold(
          error => fufail[JsObject](error),
          f => env.traffic.store.limitedReport(env.traffic.cohorts.returns(f))
        )
      )
      .map(value => Ok(value).noCache)
      .recover { case _ =>
        BadRequest(Json.obj("error" -> "Report query exceeds its budget or is unavailable"))
      }
  }
  def audio = Secure(_.ViewTrafficStats) { _ ?=> _ ?=>
    env.traffic.store.reportsReady
      .flatMap(_ => env.traffic.store.limitedReport(env.traffic.cohorts.audio()))
      .map(value => Ok(value).noCache)
  }

  def data = Secure(_.ViewTrafficStats) { _ ?=> _ ?=>
    report.map(value => Ok(value).noCache).recover { case _ =>
      BadRequest(Json.obj("error" -> "Report unavailable; check date range and collection health")).noCache
    }
  }

  def snapshot = Secure(_.ViewTrafficStats) { _ ?=> _ ?=>
    env.traffic.store.limitedReport(env.traffic.snapshots.latest).map(value => Ok(value).noCache)
  }
  def health = Secure(_.ViewTrafficStats) { _ ?=> _ ?=>
    env.traffic.api.health.map(value => Ok(value).noCache)
  }

  def exportCsv = Secure(_.ViewTrafficStats) { _ ?=> me ?=>
    report
      .map: result =>
        val rows = (result \ "groups").as[List[JsObject]]
        def cell(value: String): String = "\"" + (if value.headOption.exists("=+-@\t\r".contains(_)) then "'"
                                                  else "") + value.replace("\"", "\"\"") + "\""
        val metrics = rows.flatMap(row => (row \ "counts").as[Map[String, Long]].keys).distinct.sorted
        val lines = (List("category", "visitors", "sessions") ++ metrics).map(cell).mkString(",") :: rows.map:
          row =>
            val counts = (row \ "counts").as[Map[String, Long]]
            (List(
              (row \ "key").as[String],
              (row \ "visitors").as[Long].toString,
              (row \ "sessions").as[Long].toString
            ) ++
              metrics.map(key => counts.getOrElse(key, 0L).toString)).map(cell).mkString(",")
        lila.log("traffic.export").info(s"Aggregate CSV exported by ${me.userId}")
        Ok(lines.mkString("\r\n"))
          .as("text/csv; charset=utf-8")
          .withHeaders("Content-Disposition" -> "attachment; filename=traffic-stats.csv")
          .noCache
      .recover { case _ =>
        BadRequest(Json.obj("error" -> "Report unavailable; check date range and collection health")).noCache
      }
  }

  def events = OpenBodyOf(parse.json(16384)): ctx ?=>
    val optedOut = ctx.req.cookies.get("traffic-opt-out").exists(_.value == "1") ||
      ctx.req.headers.get("Sec-GPC").contains("1") || ctx.req.headers.get("DNT").contains("1")
    if !env.traffic.enabled || optedOut || ctx.req.client.isCrawler || ctx.me.exists(_.isBot) ||
      (!env.traffic.collectStaff && ctx.me
        .exists(me => lila.core.perm.Granter.of(_.ViewTrafficStats)(me.value)))
    then fuccess(NoContent)
    else
      ctx.body.body.validate[ClientBatch] match
        case JsSuccess(batch, _) if ClientBatch.validate(batch, nowInstant) =>
          globalLimit("site", fuccess(TooManyRequests), cost = batch.events.size):
            intakeLimit(
              HTTPRequest.ipAddress(ctx.req).toString,
              fuccess(TooManyRequests),
              cost = batch.events.size
            ):
              env.traffic.api
                .ingest(batch, ctx.me.map(_.value), ctx.req)
                .inject(NoContent)
                .recover { case _ => ServiceUnavailable }
        case _ =>
          env.traffic.api.rejected.incrementAndGet()
          fuccess(BadRequest)

  def privacy = Open(Ok.page(views.traffic.privacy))
  def privacyPost = OpenBodyOf(parse.formUrlEncoded): ctx ?=>
    val disabled = ctx.body.body.get("disabled").exists(_.contains("true"))
    fuccess(
      Redirect(routes.Traffic.privacy).withCookies(
        Cookie(
          "traffic-opt-out",
          if disabled then "1" else "0",
          maxAge = Some(10 * 365 * 86400),
          secure = ctx.req.secure,
          httpOnly = false,
          sameSite = Some(Cookie.SameSite.Lax)
        )
      )
    )
