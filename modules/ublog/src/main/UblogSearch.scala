package lila.ublog

import lila.core.ublog.{ BlogsBy, Quality }
import lila.db.dsl.{ *, given }
import scalalib.paginator.{ AdapterLike, Paginator }

object UblogSearch:
  private val han = "[\\p{IsHan}]+".r
  private def characters(run: String) =
    run.codePoints().toArray.toList.map(cp => new String(Character.toChars(cp)))
  // Mongo's non-stemming tokenizer does not segment Chinese. Index characters
  // and adjacent pairs; phrase queries over pairs match substrings without scans.
  def cjkTerms(text: String): String = han
    .findAllIn(text)
    .map: run =>
      val chars = characters(run)
      (chars ++ List("cjkboundary") ++ chars
        .sliding(2)
        .filter(_.size == 2)
        .map(_.mkString)
        .toList :+ "cjkboundary").mkString(" ")
    .mkString(" ")

  def query(text: String): String = han.replaceAllIn(
    text.replace('"', ' '),
    m =>
      val chars = characters(m.matched)
      val tokens = if chars.size == 1 then chars else chars.sliding(2).map(_.mkString).toList
      "\"" + tokens.mkString(" ") + "\""
  )

/** One indexed Mongo document per article, including only published editions. This shares the listing
  * visibility gate and needs no separate search service.
  */
final class UblogSearch(api: UblogApi, config: UblogConfig)(using Executor):
  def fetchResults(text: String, by: BlogsBy, page: Int): Fu[Paginator[UblogPost.PreviewPost]] =
    val selector = if text.trim.isEmpty then $doc("_id" -> "")
    else
      $doc("$text" -> $doc("$search" -> UblogSearch.query(text.take(100)), "$language" -> "none")) ++
        $or($doc("official" -> true), $doc("automod.quality".$gte(Quality.weak.ordinal)))
    Paginator(
      adapter = new AdapterLike[UblogPost.PreviewPost]:
        def nbResults = api.countVisiblePosts(selector)
        def slice(offset: Int, length: Int) =
          api.aggregateVisiblePosts(selector, offset, length, by, textSearch = text.trim.nonEmpty)
      ,
      currentPage = page.max(1).min(50),
      maxPerPage = config.searchPageSize
    )
