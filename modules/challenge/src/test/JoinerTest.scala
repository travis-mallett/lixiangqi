package lila.challenge

import chess.variant.{ FromPosition, Standard }
import chess.{ Clock, Ply }

import lila.xiangqi.Xiangqi

final class JoinerTest extends munit.FunSuite:

  val timeControl =
    Challenge.TimeControl.Clock(Clock.Config(Clock.LimitSeconds(300), Clock.IncrementSeconds(0)))

  test("challenge creation resolves and persists Tiantian or the explicit override"):
    val default = makeChallenge(Standard, None)
    assertEquals(default.ruleset, Some(lila.xiangqi.adjudication.Ruleset.Tiantian))
    assertEquals(
      ChallengeJoiner.gameSetup(default).toOption.get.ruleset,
      lila.xiangqi.adjudication.Ruleset.Tiantian
    )
    val custom = default.copy(ruleset = Some(lila.xiangqi.adjudication.Ruleset.Unrestricted))
    assertEquals(
      ChallengeJoiner.gameSetup(custom).toOption.get.ruleset,
      lila.xiangqi.adjudication.Ruleset.Unrestricted
    )

  test("standard challenge starts from the native Xiangqi root"):
    val challenge = makeChallenge(Standard, None)
    val game = ChallengeJoiner.createGame(challenge, None, None, Xiangqi.Game.initial)
    assertEquals(game.startedAtPly, Ply.initial)
    assertEquals(game.xiangqi.initialFen, Xiangqi.startFen)
    assertEquals(game.xiangqi.moves, Vector.empty)
    assertEquals(game.variant, Standard)

  test("from-position challenge preserves canonical Xiangqi ply and FEN"):
    val fen = "4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 7"
    val state = Xiangqi.Game.initial.state.copy(fen = fen, ply = 13, turn = Xiangqi.Side.Black)
    val xiangqi = Xiangqi.Game.fromState(fen, state).fold(fail(_), identity)
    val challenge =
      makeChallenge(FromPosition, Some[chess.format.Fen.Full](chess.format.Fen.Full(fen)))
    val game = ChallengeJoiner.createGame(challenge, None, None, xiangqi)
    assertEquals(game.startedAtPly, Ply(13))
    assertEquals(game.xiangqi.initialFen, fen)
    assertEquals(game.rated, chess.Rated.No)
    assertEquals(game.variant, FromPosition)

  test("rated friend invitations start on the chosen variant's native rank track"):
    import lila.core.game.RankedGame
    import lila.core.rank.RankTrackId
    import lila.core.user.*
    for variant <- lila.xiangqi.GameVariant.values.filter(_.playerCount == 2) do
      val track = RankTrackId.of(variant)
      val policy = lila.rating.RankPolicy(track)
      def player(name: String) = WithPerf(
        User(
          id = UserId(name.toLowerCase),
          username = UserName(name),
          count = Count(0, 0, 0, 0, 0),
          enabled = UserEnabled(true),
          roles = Nil,
          playTime = None,
          createdAt = java.time.Instant.EPOCH,
          seenAt = None,
          kid = KidMode(false),
          lang = None,
          plan = Plan(0, false, false, None),
          hasEmail = false
        ),
        lila.rating.Perf.default,
        Some(policy.initialSnapshot)
      )
      val red = player("Alice")
      val black = player("Bob")
      val standard = track == RankTrackId.xiangqi
      val clock = if standard then RankedGame.xiangqiClock else RankedGame.jieqiClock
      val limit = if standard then RankedGame.xiangqiMoveTime else RankedGame.jieqiMoveTime
      val invitation = Challenge.make(
        Standard,
        None,
        Challenge.TimeControl.Clock(clock, Some(limit)),
        chess.Rated.Yes,
        "random",
        Challenge.toRegistered(red),
        Some(black),
        None,
        ruleset = variant.defaultRuleset,
        gameVariant = variant
      )
      assert(invitation.rated.yes)
      val casual = Challenge.make(
        Standard,
        None,
        invitation.timeControl,
        chess.Rated.No,
        "random",
        Challenge.toRegistered(red),
        Some(black),
        None,
        ruleset = variant.defaultRuleset,
        gameVariant = variant
      )
      assert(casual.rated.no)
      val game = ChallengeJoiner.createGame(invitation, Some(red), Some(black)).fold(fail(_), identity)
      assertEquals(game.rankTrack, Some(track))
      assert(RankedGame.isAuthorized(game))
      assertEquals(game.metadata.source, Some(lila.core.game.Source.Friend))
      assertEquals(game.xiangqi.initialFen, variant.startFen)

      val byPost = invitation.copy(
        timeControl = Challenge.TimeControl.Correspondence(scalalib.model.Days(2)),
        rated = chess.Rated.No
      )
      val account = RankTrackId.forMode(track, true)
      def correspondent(member: WithPerf) = member.copy(rank = member.rank.map(_.copy(track = account)))
      val correspondence = ChallengeJoiner
        .createGame(byPost, Some(correspondent(red)), Some(correspondent(black)))
        .fold(fail(_), identity)
      assertEquals(correspondence.rankTrack, Some(account))
      assert(RankedGame.isAuthorized(correspondence))
      val rematch = ChallengeMaker.fromGame(
        Pov(correspondence, chess.White),
        Some(correspondent(red)),
        correspondent(black),
        GameId("rematch1")
      )
      assertEquals(rematch.gameVariant, variant)
      assertEquals(rematch.rematchOf, Some(correspondence.id))
      assertEquals(rematch.accountTrack, account)
      val joined = ChallengeJoiner
        .createGame(rematch, Some(correspondent(red)), Some(correspondent(black)))
        .fold(fail(_), identity)
      assertEquals(joined.nativeVariant, variant)
      assertEquals(joined.daysPerTurn, byPost.daysPerTurn)
      assertEquals(joined.rankTrack, Some(account))
      assertEquals(joined.id, rematch.gameId)

      if variant == lila.xiangqi.GameVariant.Xiangqi then
        val legacy = byPost.copy(ruleset = Some(lila.xiangqi.adjudication.Ruleset.Unrestricted))
        assert(
          ChallengeJoiner
            .createGame(legacy, Some(correspondent(red)), Some(correspondent(black)))
            .exists(RankedGame.isAuthorized)
        )

  test("internal challenge creation rejects incompatible board, position and rules before publication"):
    import lila.xiangqi.GameVariant
    import lila.xiangqi.adjudication.Ruleset
    def create(board: GameVariant, rules: Ruleset, fen: Option[String]) =
      Challenge.make(
        if fen.isDefined then FromPosition else Standard,
        fen.map[chess.format.Fen.Full](f => chess.format.Fen.Full(f)),
        timeControl,
        chess.Rated.No,
        "random",
        Challenge.Challenger.Open,
        None,
        None,
        ruleset = rules,
        gameVariant = board
      )
    val allowed = Map(
      GameVariant.Xiangqi -> Set(Ruleset.Tiantian, Ruleset.Unrestricted),
      GameVariant.Jieqi -> Set(Ruleset.Jieqi),
      GameVariant.Banqi -> Set(Ruleset.Banqi),
      GameVariant.MiniXiangqi -> Set(Ruleset.MiniXiangqi),
      GameVariant.Manchu -> Set(Ruleset.Manchu)
    )
    for
      board <- GameVariant.values
      rules <- Ruleset.values
    do
      if allowed.get(board).exists(_.contains(rules)) then
        val game = ChallengeJoiner.gameSetup(create(board, rules, None)).fold(fail(_), identity)
        assertEquals(game.variant, board)
        assertEquals(game.ruleset, rules)
      else intercept[IllegalArgumentException](create(board, rules, None))
    for
      board <- GameVariant.values
      position <- GameVariant.values.filter(_.playerCount == 2)
    do
      val fen = Some(position.startFen)
      if board == position && board.supportsCustomPosition then
        assert(ChallengeJoiner.gameSetup(create(board, board.defaultRuleset, fen)).exists(_.variant == board))
      else intercept[IllegalArgumentException](create(board, board.defaultRuleset, fen))

    intercept[IllegalArgumentException]:
      ChallengeJoiner.createGame(
        makeChallenge(Standard, None),
        None,
        None,
        Xiangqi.Game.initial.copy(ruleset = Ruleset.MiniXiangqi)
      )

  test("bulk pairing accepts only the variant and rules of its starting board"):
    import lila.xiangqi.GameVariant
    val base = ChallengeBulkSetup.BulkFormData(
      "first:second",
      Standard,
      None,
      None,
      Some(scalalib.model.Days(2)),
      chess.Rated.No,
      None,
      None,
      None,
      Set.empty
    )
    for board <- GameVariant.values do
      val request =
        base.copy(requestedVariant = Some(board.key), requestedRules = Some(board.defaultRuleset.key))
      assertEquals(request.validSetup, board == GameVariant.Xiangqi)
      if board.playerCount == 2 then
        assertEquals(
          request
            .copy(fen = Some[chess.format.Fen.Full](chess.format.Fen.Full(board.startFen)))
            .autoVariant
            .validSetup,
          board.supportsCustomPosition
        )

  test("a rated invitation cannot be accepted as a guest"):
    val challenge = makeChallenge(Standard, None).copy(rated = chess.Rated.Yes)
    assert(ChallengeJoiner.createGame(challenge, None, None).isLeft)

  private def makeChallenge(
      variant: chess.variant.Variant,
      initialFen: Option[chess.format.Fen.Full]
  ) =
    Challenge.make(
      variant = variant,
      gameVariant = lila.xiangqi.GameVariant.Xiangqi,
      ruleset = lila.xiangqi.GameVariant.Xiangqi.defaultRuleset,
      initialFen = initialFen,
      timeControl = timeControl,
      rated = chess.Rated.No,
      color = "white",
      challenger = Challenge.Challenger.Anonymous("secret"),
      destUser = None,
      rematchOf = None
    )
