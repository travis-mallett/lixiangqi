package lila.game

import org.apache.pekko.stream.scaladsl.*
import org.apache.pekko.util.ByteString
import chess.{ Centis, Color }
import play.api.libs.json.*
import play.api.libs.ws.JsonBodyWritables.*
import play.api.libs.ws.{ StandaloneWSClient, StandaloneWSResponse }
import scalalib.Maths

import lila.core.config.RouteUrl
import lila.core.game.{ ClockHistory, Game, Pov }
import lila.game.GameExt.*
import lila.tree.Analysis
import play.api.mvc.RequestHeader
import lila.common.HTTPRequest.queryStringBoolOpt
import chess.Ply
import chess.format.pgn.Glyph
import lila.xiangqi.Xiangqi

object GifExport:
  case class UpstreamStatus(code: Int) extends lila.core.lilaism.LilaException:
    val message = s"gif service status: $code"

  final class Options(val players: Boolean, val ratings: Boolean, val clocks: Boolean, val glyphs: Boolean)
  object Options:
    val default = Options(true, true, true, true)
    def fromReq(using RequestHeader): Options =
      Options(
        players = queryStringBoolOpt("players") | default.players,
        ratings = queryStringBoolOpt("ratings") | default.ratings,
        clocks = queryStringBoolOpt("clocks") | default.clocks,
        glyphs = queryStringBoolOpt("glyphs") | default.glyphs
      )

final class GifExport(
    ws: StandaloneWSClient,
    lightUserApi: lila.core.user.LightUserApi,
    routeUrl: RouteUrl,
    url: String
)(using Executor):
  private val targetMedianTime = Centis(80)
  private val targetMaxTime = Centis(200)

  def fromPov(
      pov: Pov,
      theme: String,
      piece: String,
      analysis: Option[Analysis],
      options: GifExport.Options
  ): Fu[Source[ByteString, ?]] =
    def showPlayer(color: Color) =
      options.players.option:
        Namer.playerTextBlocking(pov.game.players(color), withRating = options.ratings)(using
          lightUserApi.sync
        )
    upstreamResponse(s"pov ${pov.game.id}"):
      lightUserApi.preloadMany(pov.game.userIds) >>
        ws.url(s"$url/game.gif")
          .withMethod("POST")
          .addHttpHeaders("Content-Type" -> "application/json")
          .withBody(
            Json
              .obj(
                "comment" -> s"${routeUrl(routes.Round.watcher(pov.game.id, pov.color))} rendered with https://github.com/lichess-org/lila-gif",
                "orientation" -> sideName(pov.color),
                "variant" -> "xiangqi",
                "delay" -> targetMedianTime.centis, // default delay for frames
                "frames" -> frames(pov.game, analysis, options),
                "theme" -> theme,
                "piece" -> piece
              )
              .add("red", showPlayer(Color.White))
              .add("black", showPlayer(Color.Black))
          )
          .stream()

  def gameThumbnail(game: Game, theme: String, piece: String): Fu[Source[ByteString, ?]] =
    lightUserApi.preloadMany(game.userIds) >>
      thumbnail(
        position = game.position,
        red = Namer.playerTextBlocking(game.whitePlayer, withRating = true)(using lightUserApi.sync).some,
        black = Namer.playerTextBlocking(game.blackPlayer, withRating = true)(using lightUserApi.sync).some,
        orientation = game.naturalOrientation,
        lastMove = game.lastMoveKeys,
        theme = theme,
        piece = piece,
        description = s"gameThumbnail ${game.id}"
      )

  def thumbnail(
      position: Xiangqi.State,
      red: Option[String] = None,
      black: Option[String] = None,
      orientation: Color,
      lastMove: Option[String],
      theme: String,
      piece: String,
      description: String
  ): Fu[Source[ByteString, ?]] =
    upstreamResponse(description):
      ws.url(s"$url/image.gif")
        .withMethod("GET")
        .withQueryStringParameters(
          List(
            "fen" -> position.fen,
            "orientation" -> sideName(orientation),
            "variant" -> "xiangqi",
            "theme" -> theme,
            "piece" -> piece
          ) ::: List(
            red.map { "red" -> _ },
            black.map { "black" -> _ },
            lastMove.map { "lastMove" -> _ }
          ).flatten*
        )
        .stream()

  private def upstreamResponse(
      description: String
  )(res: Fu[StandaloneWSResponse]): Fu[Source[ByteString, ?]] =
    res.flatMap:
      case res if res.status != 200 =>
        logger.warn(s"GifExport $description ${res.status}")
        fufail(GifExport.UpstreamStatus(res.status))
      case res => fuccess(res.bodyAsSource)

  private def scaleMoveTimes(moveTimes: Vector[Centis]): Vector[Centis] =
    // goal for bullet: close to real-time
    // goal for classical: speed up to reach target median, avoid extremely
    // fast moves, unless they were actually played instantly
    Maths.median(moveTimes.map(_.centis)).map(Centis.ofDouble(_)).filter(_ >= targetMedianTime) match
      case Some(median) =>
        val scale = targetMedianTime.centis.toFloat / median.centis.atLeast(1).toFloat
        moveTimes.map { t =>
          if t * 2 < median then t.atMost(targetMedianTime *~ 0.5)
          else (t *~ scale).atLeast(targetMedianTime *~ 0.5).atMost(targetMaxTime)
        }
      case None => moveTimes.map(_.atMost(targetMaxTime))

  private def clockJson(clocks: Option[ClockHistory], ply: Int): Option[JsObject] =
    clocks.map: c =>
      Json
        .obj()
        .add("white", c.white.lift((ply - 1).atLeast(0) / 2).map(_.centis))
        .add("black", c.black.lift((ply - 2).atLeast(0) / 2).map(_.centis))

  private def glyphsMap(analysis: Option[Analysis]): Map[Ply, Glyph] =
    analysis.fold(Map.empty[Ply, Glyph]): a =>
      a.advices.map(adv => adv.ply -> adv.judgment.glyph).toMap

  private def frames(
      game: Game,
      analysis: Option[Analysis],
      options: GifExport.Options
  ): JsArray =
    val glyphs = options.glyphs.so(glyphsMap(analysis))
    val clocks = options.clocks.so(game.clockHistory)
    val positions = game.xiangqi.states.zipWithIndex.map: (position, index) =>
      position -> game.xiangqi.moves.lift(index - 1)
    framesRec(
      positions.zip(scaleMoveTimes(~game.moveTimes).map(some).padTo(positions.length, None)),
      glyphs,
      clocks,
      Ply.initial,
      Json.arr()
    )

  @annotation.tailrec
  private def framesRec(
      games: Vector[((Xiangqi.State, Option[Xiangqi.Uci]), Option[Centis])],
      glyphs: Map[Ply, Glyph],
      clocks: Option[ClockHistory],
      ply: Ply,
      arr: JsArray
  ): JsArray =
    games.headOption match
      case None => arr
      case Some(((position, lastMove), scaledMoveTime)) =>
        val tail = games.tail
        // longer delay for last frame
        val delay = if tail.isEmpty then Centis(500).some else scaledMoveTime
        val glyph = glyphs.get(ply)
        val clock = clockJson(clocks, ply.value)
        framesRec(
          tail,
          glyphs,
          clocks,
          ply + 1,
          arr :+ frame(position, lastMove, delay, glyph, clock)
        )

  private def frame(
      position: Xiangqi.State,
      uci: Option[Xiangqi.Uci],
      delay: Option[Centis],
      glyph: Option[Glyph],
      clock: Option[JsObject]
  ) =
    Json
      .obj(
        "fen" -> position.fen,
        "lastMove" -> uci.map(_.value),
        "variant" -> "xiangqi"
      )
      .add("check", position.check)
      .add("delay", delay.map(_.centis))
      .add("glyph", glyph.map(_.symbol))
      .add("clock", clock)

  private def sideName(color: Color) = if color == Color.White then "red" else "black"
