package lila.study

import org.apache.pekko.stream.scaladsl.*
import org.apache.pekko.util.ByteString
import play.api.libs.json.*
import play.api.libs.ws.JsonBodyWritables.*
import play.api.libs.ws.StandaloneWSClient

import lila.core.lilaism.LilaInvalid
import lila.tree.Node
import lila.common.Json.given
import lila.xiangqi.XiangqiJson.given

final class GifExport(
    ws: StandaloneWSClient,
    url: String
)(using Executor):

  def ofChapter(
      chapter: Chapter,
      theme: Option[String],
      piece: Option[String],
      showGlyphs: Boolean = true
  ): Fu[Source[ByteString, ?]] =
    ws.url(s"$url/game.gif")
      .withMethod("POST")
      .addHttpHeaders("Content-Type" -> "application/json")
      .withBody(
        Json
          .obj(
            "delay" -> 80,
            "orientation" -> chapter.setup.orientation.key,
            "red" -> List(
              chapter.tags("RedTitle"),
              chapter.tags("Red"),
              chapter.tags("RedElo").map(elo => s"($elo)")
            ).flatten.mkString(" "),
            "black" -> List(
              chapter.tags(_.BlackTitle),
              chapter.tags(_.Black),
              chapter.tags(_.BlackElo).map(elo => s"($elo)")
            ).flatten.mkString(" "),
            "frames" -> GifExport.frames(chapter, showGlyphs)
          )
          .add("theme", theme)
          .add("piece", piece)
      )
      .stream()
      .flatMap:
        case res if res.status == 200 => fuccess(res.bodyAsSource)
        case res if res.status == 400 => fufail(LilaInvalid(res.body))
        case res =>
          logger.warn(s"GifExport study ${chapter.studyId}/${chapter.id} ${res.status}")
          fufail(res.statusText)

object GifExport:
  private[study] def frames(chapter: Chapter, showGlyphs: Boolean): JsArray =
    import lila.xiangqi.Xiangqi.{ Side, BySide }
    val nodes = chapter.root :: chapter.root.mainline
    val taggedClocks = StudyPgnTags.clocks(chapter.tags)
    var clocks = BySide.fill(chapter.root.clock.map(_.centis))
    JsArray(nodes.zipWithIndex.map { (node, index) =>
      if node.moveOption.isDefined then
        clocks = clocks.update(!node.state.turn, old => node.clock.map(_.centis).orElse(old))
      val last = index == nodes.size - 1
      if last then clocks = BySide(side => taggedClocks(side).orElse(clocks(side)))
      Json
        .obj("fen" -> node.fen.value)
        .add("check", node.state.check)
        .add("shapes", node.shapes.value.nonEmpty.option(node.shapes.value))
        .add(
          "clock",
          clocks.exists(_.isDefined).option(Json.obj().add("red", clocks.red).add("black", clocks.black))
        )
        .add("lastMove", node.moveOption.map(_.uci.value))
        .add("delay", last.option(500))
        .add("glyph", showGlyphs.so(node.glyphs.move.map(_.symbol)))
    })
