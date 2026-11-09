package lila.ublog

/** Public official articles and their published editions. The query supplying these previews excludes drafts,
  * unlisted blogs, and closed authors.
  */
object UblogSitemap:
  val maxPosts = 10000

  def render(posts: List[UblogPost.PreviewPost], origin: String): String =
    require(posts.size <= maxPosts, "Blog sitemap capacity exceeded; split the sitemap before expanding")
    val entries = posts.flatMap: post =>
      val languages = UblogTranslation.normalize(post.language.value) :: post.translations
        .filter(_.published.exists(_.publishedAt.isDefined))
        .map(_.language)
      val alternatives = languages.map: language =>
        val url = escape(origin + UblogTranslation.urlOf(post, language).url)
        s"""<xhtml:link rel="alternate" hreflang="${escape(language)}" href="$url"/>"""
      languages.map: language =>
        val url = escape(origin + UblogTranslation.urlOf(post, language).url)
        val modified =
          if language == UblogTranslation.normalize(post.language.value)
          then post.updated.orElse(post.lived).getOrElse(post.created).at
          else post.translations.find(_.language == language).flatMap(_.published).get.updated.at
        s"<url><loc>$url</loc><lastmod>$modified</lastmod>${alternatives.mkString}</url>"
    require(entries.size <= 50000, "Sitemap URL limit exceeded")
    s"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.mkString}</urlset>"""

  private def escape(value: String): String =
    value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
