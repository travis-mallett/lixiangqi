package lila.ublog

import play.api.libs.json.*
import lila.core.LightUser
import lila.common.Json.given

final class UblogJsonView(picfitUrl: lila.memo.PicfitUrl, lightUser: LightUser.GetterSync):

  def writer(language: String): OWrites[UblogPost.PreviewPost] = OWrites: source =>
    val p = source.forLanguage(language)
    Json
      .obj(
        "id" -> p.id,
        "title" -> p.title,
        "intro" -> p.intro,
        "slug" -> p.slug,
        "createdAt" -> p.created.at,
        "url" -> UblogTranslation.urlOf(p, p.editionLanguage).url,
        "language" -> p.editionLanguage,
        "sourceLanguage" -> UblogTranslation.normalize(p.language.value),
        "editions" -> UblogTranslation
          .available(source)
          .map: lang =>
            Json.obj("language" -> lang, "url" -> UblogTranslation.urlOf(source, lang).url)
      )
      .add("author" -> lightUser(p.created.by))
      .add("imageAlt" -> p.image.flatMap(_.alt))
      .add("image" -> p.image.map(i => UblogPost.thumbnail(picfitUrl, i.id, _.Size.Small)))
