package lila.api

import chess.Black
import reactivemongo.api.bson.BSONDocument

import lila.core.rank.RankTrackId
import lila.core.user.{ Count, KidMode, Me, Plan, User, UserEnabled }
import lila.core.userId.{ UserId, UserName }
import lila.db.dsl.{ *, given }
import lila.game.{ Game, Query }

class ByUserGameFilterTest extends munit.FunSuite:

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
  private val opponent = user.copy(
    id = UserId("exportopponent"),
    username = UserName("ExportOpponent")
  )

  test("casual export queries rank tracks directly with other filters"):
    val config = GameApiV2.ByUserConfig(
      user = user,
      vs = Some(opponent),
      format = GameApiV2.Format.PGN,
      since = Some(java.time.Instant.parse("2024-01-01T00:00:00Z")),
      until = Some(java.time.Instant.parse("2025-01-01T00:00:00Z")),
      ranked = Some(false),
      analysed = Some(false),
      color = Some(Black),
      flags = lila.game.PgnDump.WithFlags(),
      sort = GameApiV2.GameSort.DateDesc,
      perSecond = MaxPerSecond(10)
    )

    val query = config.toMongoQuery(Query.opponents(user, opponent))
    val rankTrackFilter = query.getAsOpt[BSONDocument](Game.BSONFields.rankTrack).get
    val playerFilter = query.getAsOpt[BSONDocument](Game.BSONFields.playerUids).get

    assertEquals(
      rankTrackFilter.getAsOpt[List[String]]("$nin"),
      Some(RankTrackId.all.map(_.value))
    )
    assertEquals(query.getAsOpt[UserId]("us.1"), Some(user.id))
    assertEquals(
      playerFilter.getAsOpt[List[UserId]]("$all").map(_.toSet),
      Some(Set(user.id, opponent.id))
    )
    assertEquals(query.getAsOpt[BSONDocument]("an").flatMap(_.getAsOpt[Boolean]("$ne")), Some(true))
    assert(query.contains(Game.BSONFields.createdAt))
    assert(query.contains(Game.BSONFields.status))
    assertEquals(query.getAsOpt[Boolean](Game.BSONFields.rated), None)
    assert(config.useMongoQuery)

  test("Black-only export queries the stored black user position without adding a ranking filter"):
    val config = GameApiV2.ByUserConfig(
      user = user,
      vs = None,
      format = GameApiV2.Format.PGN,
      ranked = None,
      analysed = None,
      color = Some(Black),
      flags = lila.game.PgnDump.WithFlags(),
      sort = GameApiV2.GameSort.DateDesc,
      perSecond = MaxPerSecond(10)
    )

    val query = config.toMongoQuery(Query.user(user.id))

    assertEquals(query.getAsOpt[UserId]("us.1"), Some(user.id))
    assertEquals(query.getAsOpt[BSONDocument](Game.BSONFields.rankTrack), None)
    assertEquals(query.getAsOpt[BSONDocument]("an"), None)
    assert(config.useMongoQuery)
    assert(!config.copy(color = Some(chess.White)).useMongoQuery)
    assert(config.copy(color = Some(chess.White), ranked = Some(false)).useMongoQuery)

  test("ranked Black export selects persisted rank tracks"):
    val config = GameApiV2.ByUserConfig(
      user = user,
      vs = None,
      format = GameApiV2.Format.PGN,
      ranked = Some(true),
      analysed = None,
      color = Some(Black),
      flags = lila.game.PgnDump.WithFlags(),
      sort = GameApiV2.GameSort.DateDesc,
      perSecond = MaxPerSecond(10)
    )

    val query = config.toMongoQuery(Query.user(user.id))
    val rankTrackFilter = query.getAsOpt[BSONDocument](Game.BSONFields.rankTrack).get

    assertEquals(
      rankTrackFilter.getAsOpt[List[String]]("$in"),
      Some(RankTrackId.all.map(_.value))
    )
    assertEquals(query.getAsOpt[UserId]("us.1"), Some(user.id))
