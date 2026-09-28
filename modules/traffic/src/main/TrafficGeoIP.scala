package lila.traffic

import com.maxmind.db.Reader.FileMode
import com.maxmind.geoip2.DatabaseReader
import lila.core.net.IpAddress
import lila.security.Location

/** Local, memory-mapped geography with a bounded transient IP cache; no raw IP is persisted. */
final class TrafficGeoIP(path: String)(using Executor) extends AutoCloseable:
  private val reader =
    scala.util.Try(DatabaseReader.Builder(java.io.File(path)).fileMode(FileMode.MEMORY_MAPPED).build).toOption
  if reader.isEmpty then logger.warn(s"Traffic geography unavailable: $path")
  private val cache = lila.memo.CacheApi.scaffeineNoScheduler
    .maximumSize(10000)
    .expireAfterAccess(20.minutes)
    .build[IpAddress, Option[Location]](ip =>
      for
        db <- reader
        address <- ip.inet
        response <- scala.util.Try(db.city(address)).toOption
      yield Location(response)
    )
  def apply(ip: IpAddress): Option[Location] = if reader.isDefined then cache.get(ip) else None
  def isAvailable: Boolean = reader.isDefined
  def close(): Unit = reader.foreach(_.close())
