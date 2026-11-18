package lila.ublog

/** Public official articles and their published editions. The query supplying these previews excludes drafts,
  * unlisted blogs, and closed authors.
  */
object UblogSitemap:
  val maxPosts = 10000

  def entries(posts: List[UblogPost.PreviewPost]): List[lila.common.Sitemap.Entry] =
    require(posts.size <= maxPosts, "Blog sitemap capacity exceeded; split the sitemap before expanding")
    posts.flatMap: post =>
      val languages = UblogTranslation.normalize(post.language.value) :: post.translations
        .filter(_.published.exists(_.publishedAt.isDefined))
        .map(_.language)
      val alternatives = languages.map: language =>
        language -> UblogTranslation.urlOf(post, language).url
      languages.map: language =>
        val modified =
          if language == UblogTranslation.normalize(post.language.value)
          then post.updated.orElse(post.lived).getOrElse(post.created).at
          else post.translations.find(_.language == language).flatMap(_.published).get.updated.at
        lila.common.Sitemap.Entry(UblogTranslation.urlOf(post, language).url, Some(modified), alternatives)
