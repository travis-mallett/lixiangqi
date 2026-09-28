package lila.traffic

import play.api.Configuration
import com.softwaremill.macwire.Module
import lila.common.{ Bus, LilaScheduler }
import lila.core.traffic.TrafficEvent

@Module
final class Env(
    appConfig: Configuration,
    mongo: lila.db.Env,
    prefApi: lila.pref.PrefApi,
    userRepo: lila.user.UserRepo
)(using system: org.apache.pekko.actor.ActorSystem, scheduler: Scheduler):
  private given Executor = system.dispatchers.lookup("traffic-dispatcher")
  val enabled = appConfig.get[Boolean]("traffic.enabled")
  val collectStaff = appConfig.get[Boolean]("traffic.collect_staff")
  private val database = mongo.asyncDb("traffic", appConfig.get[String]("traffic.mongodb_uri"))
  private val identity = TrafficIdentity(appConfig.get[String]("traffic.identity_key"))
  val store = TrafficStore(database, Some(identity("key-check", "traffic-v1")))
  private val geoIP = TrafficGeoIP(appConfig.get[String]("traffic.geoip.file"))
  system.registerOnTermination(geoIP.close())
  val api = TrafficApi(enabled, identity, store, geoIP)
  val processor = TrafficProcessor(store)
  val erasure = TrafficErasure(store, identity, processor)
  val query = TrafficQuery(store)
  val cohorts = TrafficCohorts(store)
  val snapshots = TrafficSnapshots(store, prefApi, userRepo, api)
  private val working = new java.util.concurrent.atomic.AtomicBoolean(false)

  // Disabling intake must not prevent pending events or account erasures from being processed.
  LilaScheduler("traffic.flush", _.Every(2.seconds), _.AtMost(15.seconds), _.Delay(10.seconds)):
    api.flush().recover { case e => logger.warn("Event journal write failed", e) }
  LilaScheduler("traffic.process", _.Every(2.seconds), _.AtMost(30.seconds), _.Delay(15.seconds)):
    if !working.compareAndSet(false, true) then funit
    else
      erasure
        .step()
        .flatMap: active =>
          if active then
            query.invalidate()
            funit
          else processor.run()
        .andThen { case _ => working.set(false) }
        .recover { case e => logger.warn("Event processing failed", e) }
  if enabled then
    LilaScheduler("traffic.snapshot", _.Every(1.minute), _.AtMost(30.seconds), _.Delay(25.seconds)):
      snapshots.run().recover { case e => logger.warn("Account snapshot failed", e) }
    LilaScheduler("traffic.catalog", _.Every(1.hour), _.AtMost(30.seconds), _.Delay(20.seconds)):
      store.rememberCatalog().recover { case e => logger.warn("Catalog snapshot failed", e) }

  Bus.sub[lila.core.game.FinishGame]: finish =>
    val game = finish.game
    api.domain(
      TrafficEvent(
        s"game-completed/${game.id}",
        "game.completed",
        nowInstant,
        dimensions = Map(
          "game" -> game.id.value,
          "outcome" -> (if game.aborted then "aborted" else "completed"),
          "mode" -> (if game.rated.yes then "rated" else "casual")
        ),
        values = Map.empty
      )
    )
    if !game.aborted && game.playedPlies.value >= 2 then
      game.userIds.foreach: id =>
        api.domain(
          TrafficEvent(s"user-game/${game.id}/${id.value}", "user.gameCompleted", nowInstant, Some(id))
        )
