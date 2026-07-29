package controllers

import org.apache.pekko.stream.scaladsl.*
import org.apache.pekko.util.ByteString
import chess.variant.Variant
import play.api.mvc.Result

import lila.app.{ *, given }
import lila.core.id.PuzzleId
import lila.pref.{ BoardThemes, PieceSets }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final class Export(env: Env) extends LilaController(env):

  private def exportImageOf[A](fetch: Fu[Option[A]])(convert: A => Fu[Result])(using Context) =
    Found(fetch): res =>
      limit.exportImage(((), req.ipAddress), rateLimited)(convert(res))

  def gif(
      id: GameId,
      color: Color,
      theme: Option[String],
      piece: Option[String]
  ) = Anon:
    NoCrawlersUnlessPreview:
      exportImageOf(env.game.gameRepo.game(id)): game =>
        val options = lila.game.GifExport.Options.fromReq
        val filename = s"lixiangqi-game-${game.id}-${color.name}.gif"
        stream(filename, cacheSeconds = if game.finishedOrAborted then 3600 * 24 else 10):
          for
            analysis <- options.glyphs.so(env.analyse.repo.byGame(game))
            source <- env.game.gifExport.fromPov(
              Pov(game, color),
              BoardThemes.get(theme).key,
              PieceSets.get(piece).key,
              analysis,
              options
            )
          yield source

  def legacyGameThumbnail(id: GameId, theme: Option[String], piece: Option[String]) = Anon:
    MovedPermanently(routes.Export.gameThumbnail(id, theme, piece).url)

  def gameThumbnail(id: GameId, theme: Option[String], piece: Option[String]) = Anon:
    exportImageOf(env.game.gameRepo.game(id)) { game =>
      val filename = s"lixiangqi-game-${game.id}-thumbnail.gif"
      env.game.gifExport
        .gameThumbnail(game, BoardThemes.get(theme).key, PieceSets.get(piece).key)
        .pipe(stream(filename, cacheSeconds = if game.finishedOrAborted then 3600 * 24 else 10))
    }

  def puzzleThumbnail(id: PuzzleId, theme: Option[String], piece: Option[String]) = Anon:
    exportImageOf(env.puzzle.api.puzzle.find(id)): puzzle =>
      env.game.gifExport
        .thumbnail(
          position = puzzle.stateAfterInitialMove.err(s"invalid puzzle ${puzzle.id}"),
          lastMove = puzzle.line.head.value.some,
          orientation = puzzle.color,
          theme = BoardThemes.get(theme).key,
          piece = PieceSets.get(piece).key,
          description = s"puzzleThumbnail ${puzzle.id}"
        )
        .pipe(stream(s"lixiangqi-puzzle-${puzzle.id}.gif"))

  def fenThumbnail(
      fen: String,
      color: Option[Color],
      lastMove: Option[String],
      variant: Option[Variant.LilaKey],
      theme: Option[String],
      piece: Option[String]
  ) = Anon:
    val supportedVariant = variant.forall: key =>
      key == chess.variant.Standard.key || key == chess.variant.FromPosition.key
    val position =
      if supportedVariant
      then fuccess(XiangqiRules.position(Xiangqi.Position(initialFen = fen)).toOption)
      else fuccess(none)
    exportImageOf(position): position =>
      env.game.gifExport
        .thumbnail(
          position = position,
          lastMove = lastMove,
          orientation = color | Color.white,
          theme = BoardThemes.get(theme).key,
          piece = PieceSets.get(piece).key,
          description = s"fenThumbnail $fen"
        )
        .pipe(stream(s"lixiangqi-fen.gif"))

  private def stream(filename: String, contentType: String = "image/gif", cacheSeconds: Int = 1209600)(
      upstream: Fu[Source[ByteString, ?]]
  ): Fu[Result] = upstream
    .map: stream =>
      Ok.chunked(stream)
        .headerCacheSeconds(cacheSeconds)
        .as(contentType)
        .asAttachmentStream(filename)
    .recover { case lila.game.GifExport.UpstreamStatus(code) => Status(code) }
