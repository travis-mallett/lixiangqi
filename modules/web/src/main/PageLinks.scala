package lila.web

object PageLinks:
  // Keep explicit language URLs self-canonical. The unprefixed URL remains the
  // language-negotiating x-default; cookies must not change its canonical URL.
  def localizedCanonical(basePath: String, requestPath: String): String =
    val path = basePath.takeWhile(_ != '?')
    val query = basePath.drop(path.length)
    val suffix = if path == "/" then "" else path
    val prefix = requestPath.stripSuffix(suffix)
    if requestPath.endsWith(suffix) && prefix.matches("/[a-z]{2,3}") then requestPath + query
    else basePath
