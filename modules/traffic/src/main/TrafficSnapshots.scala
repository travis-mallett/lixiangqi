package lila.traffic

import java.util.concurrent.atomic.AtomicBoolean
import play.api.libs.json.*
import reactivemongo.api.bson.*
import lila.core.traffic.TrafficEvent
import lila.db.dsl.{ *, given }

/** Resumable account census. Each chunk and its cursor commit together; incomplete generations stay hidden.
  */
final class TrafficSnapshots(
    store: TrafficStore,
    prefApi: lila.pref.PrefApi,
    userRepo: lila.user.UserRepo,
    api: TrafficApi
)(using Executor):
  private val running = new AtomicBoolean(false)

  def run(): Funit =
    if !running.compareAndSet(false, true) then funit
    else nextChunk().andThen { case _ => running.set(false) }

  private def nextChunk(): Funit =
    for
      progress <- store.state(_.one[Bdoc]($id("snapshot")))
      today = TrafficTime.bucket(nowInstant, "day").toString
      day = progress
        .filterNot(_.getAsOpt[Boolean]("complete").contains(true))
        .flatMap(_.getAsOpt[String]("day"))
        .getOrElse(today)
      _ <-
        if progress.exists(p =>
            p.getAsOpt[String]("day").contains(day) && p.getAsOpt[Boolean]("complete").contains(true)
          )
        then funit
        else
          val cursor =
            progress.filter(_.getAsOpt[String]("day").contains(day)).flatMap(_.getAsOpt[String]("cursor"))
          val selector = cursor.fold($empty)(id => $doc("_id" -> $doc("$gt" -> id)))
          for
            users <- userRepo.withColl(_.find(selector).sort($sort.asc("_id")).cursor[Bdoc]().list(200))
            ids = users.flatMap(_.getAsOpt[UserId]("_id"))
            preferences <- prefApi.byIds(ids)
            _ <- api.persistDomain(users.flatMap: user =>
              for id <- user.getAsOpt[UserId]("_id"); at <- user.getAsOpt[Instant]("createdAt")
              yield TrafficEvent(
                s"registration/${id.value}",
                "user.registered",
                at,
                Some(id),
                dimensions = Map("language" -> user.getAsOpt[String]("lang").getOrElse("unknown"))
              ))
            _ <- store.transaction: db =>
              val snapshots: Coll = db.collection(store.snapshots.name.value)
              val state: Coll = db.collection(store.state.name.value)
              for
                current <- state.one[Bdoc]($id("snapshot"))
                _ <-
                  if current != progress then fufail[Unit]("Snapshot cursor changed; retrying next cycle")
                  else funit
                entries = users.flatMap: user =>
                  val id = user.getAsOpt[UserId]("_id").get
                  val eligible = user
                    .getAsOpt[Boolean]("enabled")
                    .contains(true) && !user.getAsOpt[String]("title").contains("BOT")
                  val appearance =
                    if eligible then TrafficCatalog.appearance(preferences(id).appearance).toList else Nil
                  val profile = user.getAsOpt[Bdoc]("profile")
                  List(
                    "accounts" -> "recorded",
                    "accounts" -> (if eligible then "enabled" else "closed-or-bot")
                  ) ++
                    appearance ++ Option.when(eligible)(
                      "country" -> profile.flatMap(_.getAsOpt[String]("country")).getOrElse("unknown")
                    ) ++
                    Option.when(eligible)("language" -> user.getAsOpt[String]("lang").getOrElse("unknown")) ++
                    Option.when(eligible)(
                      "boardPieces" -> s"${preferences(id).boardTheme}|${preferences(id).pieceSet}"
                    )
                grouped = entries.groupMapReduce(identity)(_ => 1L)(_ + _)
                update = snapshots.update(ordered = false)
                elements <- grouped.toList.traverse: (entry, count) =>
                  val (dimension, key) = entry
                  update.element(
                    $id(s"$day/$dimension/$key"),
                    $set($doc("day" -> day, "dimension" -> dimension, "key" -> key)) ++ $inc(
                      "count" -> count
                    ),
                    upsert = true,
                    multi = false
                  )
                _ <- elements.nonEmpty.so(update.many(elements).void)
                _ <- state.update.one(
                  $id("snapshot"),
                  $set(
                    $doc(
                      "day" -> day,
                      "cursor" -> ids.lastOption.map(_.value),
                      "complete" -> (users.size < 200)
                    )
                  ),
                  upsert = true
                )
                _ <- (users.size < 200).so(
                  state.update.one($id("snapshotPublished"), $set("day" -> day), upsert = true).void
                )
              yield ()
          yield ()
    yield ()

  def latest: Fu[JsObject] = for
    state <- store.state(_.one[Bdoc]($id("snapshotPublished")))
    day = state.flatMap(_.getAsOpt[String]("day"))
    rows <- day.so(value => store.snapshots(_.find($doc("day" -> value)).cursor[Bdoc]().list(10000)))
  yield Json.obj(
    "day" -> day,
    "rows" -> rows.map: row =>
      Json.obj(
        "dimension" -> row.getAsOpt[String]("dimension"),
        "key" -> row.getAsOpt[String]("key"),
        "count" -> row.getAsOpt[Long]("count")
      )
  )
