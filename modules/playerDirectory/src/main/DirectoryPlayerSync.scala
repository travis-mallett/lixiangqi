package lila.playerDirectory

import org.apache.pekko.stream.scaladsl.*
import org.apache.pekko.util.ByteString
import play.api.libs.ws.StandaloneWSClient
import reactivemongo.api.bson.*
import lila.core.playerDirectory.{ Federation, PlayerId, Provenance, RatingCategory }
import lila.db.dsl.{ *, given }

final private class DirectoryPlayerSync(
    repo: DirectoryRepo,
    ws: StandaloneWSClient,
    proxy: lila.memo.HttpProxy
)(using
    Executor,
    org.apache.pekko.stream.Materializer
):
  private val running = java.util.concurrent.atomic.AtomicBoolean(false)

  def apply(): Funit =
    if !running.compareAndSet(false, true) then fufail("Player directory sync is already running")
    else
      val result = for
        page <- fetch(WxfRoster.pageUrl, 2 * 1024 * 1024)
        publication = WxfRoster.publication(page.utf8String)
        (url, date) = publication
        pdf <- fetch(url, 5 * 1024 * 1024)
        // Parse the complete publication before the first database mutation.
        players <- scala.concurrent.Future(
          scala.concurrent.blocking(WxfRoster.fromPdf(pdf.toArray, Provenance("wxf", url, date)))
        )
        _ <- players.grouped(200).toList.sequentiallyVoid(save)
        _ <- federationsFromPlayers()
      yield logger.info(s"Native player directory synchronized ${players.size} WXF titles published $date")
      result.andThen { case _ => running.set(false) }.logFailure(logger)

  private def fetch(url: String, maxBytes: Long): Fu[ByteString] =
    val request = proxy.select().foldLeft(ws.url(url))(_ withProxyServer _)
    request
      .withRequestTimeout(30.seconds)
      .stream()
      .flatMap: response =>
        if response.status != 200 then
          response.bodyAsSource.runWith(Sink.cancelled)
          fufail(s"Player directory source returned HTTP ${response.status}")
        else response.bodyAsSource.limitWeighted(maxBytes)(_.size.toLong).runFold(ByteString.empty)(_ ++ _)

  import repo.player.handler

  private def save(players: List[DirectoryPlayer]): Funit =
    repo.player
      .fetch(players.map(_.id))
      .flatMap: previous =>
        val existing = previous.mapBy(_.id)
        players.sequentiallyVoid: source =>
          val old = existing.get(source.id)
          if old.exists(_.isSame(source)) then funit
          else
            val player = source.copy(photo = old.flatMap(_.photo), deceasedYear = old.flatMap(_.deceasedYear))
            repo.playerColl.update.one($id(player.id), player, upsert = true).void

  private object federationsFromPlayers:
    def apply(): Funit = for
      feds <- repo.playerColl
        .aggregateList(500, _.sec): framework =>
          import framework.*
          Match(repo.player.selectActive) ->
            List(PipelineOperator($doc("$sortByCount" -> "$fed")))
        .map: objs =>
          for
            obj <- objs
            code <- obj.getAsOpt[Federation.Id]("_id")
            name <- lila.playerDirectory.Federation.names.get(code).map(_._1)
            nbPlayers <- obj.int("count")
            if nbPlayers > 0
          yield (code, name, nbPlayers)
      // TODO https://www.mongodb.com/docs/manual/reference/operator/aggregation/topN/
      federations <- feds.traverse: (code, name, nbPlayers) =>
        repo.playerColl
          .aggregateOne(_.sec): framework =>
            import framework.*
            val facets = for
              tc <- RatingCategory.values.toList
              facet <- List(
                "top" -> List(
                  Project($doc("_id" -> 0, tc.toString -> 1)),
                  Sort(Descending(tc.toString)),
                  Limit(10),
                  Group(BSONString(s"$tc-top"))("v" -> AvgField(tc.toString))
                ),
                "count" -> List(
                  Match(tc.toString.$exists(true)),
                  Group(BSONString(s"$tc-count"))("v" -> SumAll)
                )
              )
            yield s"$tc-${facet._1}" -> facet._2
            Match(repo.player.selectActive ++ $doc("fed" -> code)) ->
              List(
                Facet(facets),
                Project($doc("all" -> $doc("$setUnion" -> facets.map((k, _) => s"$$$k").toList))),
                UnwindField("all"),
                ReplaceRootField("all"),
                Project($doc("k" -> "$_id", "v" -> true, "_id" -> false)),
                Group(BSONNull)("all" -> PushField("$ROOT")),
                Project($doc("_id" -> $doc("$arrayToObject" -> "$all"))),
                ReplaceRootField("_id")
              )
          .map2: o =>
            def stats(tc: RatingCategory) = Federation.Stats(
              rank = 0,
              nbPlayers = ~o.int(s"$tc-count"),
              top10Rating = ~o.double(s"$tc-top").map(_.toInt)
            )
            lila.playerDirectory.Federation(
              id = code,
              name = name,
              nbPlayers = nbPlayers,
              standard = stats(RatingCategory.standard),
              rapid = stats(RatingCategory.rapid),
              blitz = stats(RatingCategory.blitz),
              updatedAt = nowInstant
            )
      ranked = RatingCategory.values.foldLeft(federations.flatten): (acc, tc) =>
        acc
          .sortBy(-_.stats(tc).get.top10Rating)
          .zipWithIndex
          .map: (fed, index) =>
            fed.stats(tc).modify(_.copy(rank = index + 1))
      _ <- ranked.sequentially(repo.federation.upsert)
    yield ()
