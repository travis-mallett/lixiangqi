package lila.api

import chess.Black
import reactivemongo.api.bson.BSONDocument

import lila.core.rank.RankTrackId
import lila.core.user.{ Count, KidMode, Me, Plan, User, UserEnabled }
import lila.core.userId.{ UserId, UserName }
import lila.db.dsl.{ *, given }
import lila.game.{ Game, Query }

class ByUserCasualExportTest extends munit.FunSuite:

  private given Option[Me] = None

  private val user = User(
    id = UserId("exporttest"),
    username = UserName("ExportTest"),
    count = Count(0, 0, 0, 0, 0),
    enabled = UserEnabled.Yes,
    roles = Nil,
    playTime = None,
    createdAt = java.time.Instant.EPOCH,
    seenAt = None,
    kid = KidMode.No,
    lang = None,
    plan = Plan(0, active = false, lifetime = false, since = None),
    hasEmail = false
  )

  test("casual export queries rank tracks directly, including when other indexed filters are set"):
    val config = GameApiV2.ByUserConfig(
      user = user,
      vs = None,
      format = GameApiV2.Format.PGN,
      ranked = Some(false),
      analysed = Some(false),
      color = Some(Black),
      flags = lila.game.PgnDump.WithFlags(),
      sort = GameApiV2.GameSort.DateDesc,
      perSecond = MaxPerSecond(10)
    )

    val query = config.toCasualQuery(Query.user(user.id))
    val rankTrackFilter = query.getAsOpt[BSONDocument](Game.BSONFields.rankTrack).get

    assertEquals(
      rankTrackFilter.getAsOpt[List[String]]("$nin"),
      Some(RankTrackId.all.map(_.value))
    )
    assertEquals(query.getAsOpt[UserId]("us.1"), Some(user.id))
    assertEquals(query.getAsOpt[BSONDocument]("an").flatMap(_.getAsOpt[Boolean]("$ne")), Some(true))
    assertEquals(query.getAsOpt[Boolean](Game.BSONFields.rated), None)
