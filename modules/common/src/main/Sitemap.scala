package lila.common

import java.time.Instant

/** One XML writer for canonical public pages. Callers own publication and visibility rules. */
object Sitemap:
  case class Entry(path: String, modified: Option[Instant] = None, alternates: List[(String, String)] = Nil)

  def render(entries: List[Entry], origin: String): String =
    require(entries.size <= 50000, "Sitemap URL limit exceeded")
    require(entries.map(_.path).distinct.size == entries.size, "Duplicate sitemap URL")
    def url(path: String): String =
      require(path.startsWith("/") && !path.startsWith("//"), "Sitemap URLs must belong to this site")
      escape(origin.stripSuffix("/") + path)
    val body = entries.map: entry =>
      val modified = entry.modified.fold("")(at => s"<lastmod>$at</lastmod>")
      val alternatives = entry.alternates.map: (language, path) =>
        s"""<xhtml:link rel="alternate" hreflang="${escape(language)}" href="${url(path)}"/>"""
      s"<url><loc>${url(entry.path)}</loc>$modified${alternatives.mkString}</url>"
    s"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body.mkString}</urlset>"""

  private def escape(value: String): String =
    value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
