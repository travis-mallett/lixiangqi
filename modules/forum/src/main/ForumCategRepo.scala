package lila.forum

import lila.db.dsl.{ *, given }
import lila.core.perm.Granter

final private class ForumCategRepo(val coll: Coll, cacheApi: lila.memo.CacheApi)(using Executor):

  import BSONHandlers.given

  // Wait for provisioning on first use, including direct category/topic URLs. Successful
  // initialization is cached for this process; failed loads are evicted and can retry.
  // Insert-only upserts preserve existing posts, counters, and category settings.
  private val provisioned = cacheApi.unit[Unit]("forum.siteBoards"):
    _.buildAsyncFuture: _ =>
      ForumCateg.siteBoards
        .sequentially: categ =>
          coll.update
            .one($id(categ.id), $doc("$setOnInsert" -> categ), upsert = true)
            .void
        .void

  def byId(id: ForumCategId) = provisioned.get(()) >> coll.byId[ForumCateg](id)

  def visibleWithTeams(teams: Iterable[TeamId], forUser: Option[User]): Fu[List[ForumCateg]] =
    val (isMod, isDev) = forUser.fold((false, false)): u =>
      (Granter.of(_.ModerateForum)(u), Granter.of(_.Diagnostics)(u))
    provisioned.get(()) >> coll
      .find(
        $or(
          List(
            ($doc("team".$exists(false)) ++ (!isMod).so($doc("hidden".$ne(true)))).some,
            teams.nonEmpty.option($doc("team".$in(teams))),
            isDev.option($id(ForumCateg.diagnosticId))
          ).flatten*
        )
      )
      .cursor[ForumCateg]()
      .list(100)

  def nbPosts(id: String): Fu[Int] =
    coll.primitiveOne[Int]($id(id), "nbPosts").dmap(~_)
