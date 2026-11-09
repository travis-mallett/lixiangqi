package lila.web

/** Only content-addressed build outputs are immutable. Never cache a failed asset response. */
private[web] object AssetCacheControl:
  private val fingerprinted =
    """^/assets/(?:css|compiled|hashed)/(?:[^/]+/)*[^/]+\.(?:[a-f0-9]{8,64}|[A-Z0-9]{8})\.[a-z0-9]+$""".r

  def apply(path: String, status: Int): String =
    if status != 200 && status != 206 && status != 304 then "no-store"
    else if fingerprinted.matches(path) then "public, max-age=31536000, immutable"
    else if path.endsWith(".json") || path.endsWith(".js") || path.endsWith(".css") then "no-cache"
    else "public, max-age=3600"
