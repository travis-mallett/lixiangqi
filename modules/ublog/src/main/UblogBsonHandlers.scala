package lila.ublog

import scala.util.Success
import play.api.i18n.Lang
import reactivemongo.api.bson.*

import lila.db.dsl.{ *, given }

private object UblogBsonHandlers:

  import UblogPost.{ LightPost, PreviewPost, Recorded, Featured }
  import UblogAutomod.Assessment
  import lila.core.ublog.Quality

  given BSONHandler[UblogBlog.Id] = tryHandler(
    { case BSONString(v) => UblogBlog.Id(v).toTry(s"Invalid blog id $v") },
    id => BSONString(id.full)
  )
  given BSONDocumentHandler[UblogBlog] = Macros.handler
  given BSONHandler[Lang] = langByCodeHandler
  given BSONDocumentHandler[Recorded] = Macros.handler
  given BSONDocumentHandler[Featured] = Macros.handler
  given BSONDocumentHandler[UblogImage] = Macros.handler
  private def withSearchTerms(doc: Bdoc): Bdoc = doc ++ $doc(
    "searchCjk" ->
      UblogSearch.cjkTerms(List("title", "intro", "markdown").flatMap(doc.getAsOpt[String]).mkString("\n"))
  )

  given BSONDocumentHandler[UblogTranslation.Revision] =
    Macros.handler[UblogTranslation.Revision].afterWrite(withSearchTerms)
  given BSONDocumentHandler[UblogTranslation] = Macros.handler
  given BSONDocumentHandler[UblogTranslation.PreviewContent] = Macros.handler
  given BSONDocumentHandler[UblogTranslation.Preview] = Macros.handler
  given BSONDocumentHandler[UblogPost] = Macros.handler[UblogPost].afterWrite(withSearchTerms)
  given BSONDocumentHandler[LightPost] = Macros.handler
  given BSONDocumentHandler[PreviewPost] = Macros.handler
  given BSONDocumentHandler[UblogSimilar] = Macros.handler
  given BSONHandler[Quality] = tryHandler(
    v => v.asOpt[Int].flatMap(Quality.values.lift).toTry(s"bad quality $v"),
    quality => BSONInteger(quality.ordinal)
  )
  given BSONDocumentHandler[UblogAutomod.Assessment] = Macros.handler

  val postProjection = $doc("likers" -> false)
  val lightPostProjection = $doc("title" -> true)
  val previewPostProjection =
    $doc(
      "blog" -> true,
      "title" -> true,
      "intro" -> true,
      "image" -> true,
      "created" -> true,
      "updated" -> true,
      "lived" -> true,
      "featured" -> true,
      "topics" -> true,
      "sticky" -> true,
      "official" -> true,
      "language" -> true,
      "translations.language" -> true,
      "translations.published.title" -> true,
      "translations.published.intro" -> true,
      "translations.published.imageAlt" -> true,
      "translations.published.imageCredit" -> true,
      "translations.published.updated" -> true,
      "translations.published.publishedAt" -> true
    )

  val userLiveSort = $doc("sticky" -> -1, "lived.at" -> -1)
