package lila.msg

import lila.core.security.SubmissionPolicy

class SubmissionPolicyTest extends munit.FunSuite:
  test("ordinary English, Chinese and Vietnamese messages stay on the local text path"):
    List(
      "Good game!",
      "好棋，下次再来！",
      "Ván cờ hay, cảm ơn!",
      "https://example.com/game",
      "https://chess-bot.com.example.org",
      "https://notchess-bot.com"
    ).foreach(text => assert(!SubmissionPolicy.blocked(text), text))

  test("confirmed unsafe destinations and exposed credentials are rejected before submission"):
    List(
      "Try https://chess-bot.com",
      "请看 https://CHESS-BOT.COM/。",
      "Xem https://www.chess-bot.com/game",
      "https://example.org/auth/magic-link/login/token"
    ).foreach(text => assert(SubmissionPolicy.blocked(text), text))

  test("measure the local decision on ordinary multilingual messages"):
    val values = List("Good game", "好棋，下次再来", "Ván cờ hay", "https://lixiangqi.org/forum").toArray
    def batch() =
      val start = System.nanoTime()
      var i = 0
      var rejected = 0
      while i < 10000 do
        if SubmissionPolicy.blocked(values(i % values.length)) then rejected += 1
        i += 1
      assertEquals(rejected, 0)
      System.nanoTime() - start
    batch()
    val samples = List.fill(25)(batch() / 10000).sorted
    println(
      s"Local text rule nanoseconds per decision (10,000-decision batches), median ${samples(12)}, p95 ${samples(23)}"
    )

  test("attachment-only input round trips with its exact handles and nonce identity"):
    val handle = "12" * 16
    val accepted = Msg
      .make("", UserId("alice"), java.time.Instant.EPOCH, List(handle))
      .get
      .copy(requestDigest = Some("proof"))
    import BsonHandlers.given
    import lila.db.dsl.{ *, given }
    assertEquals(
      BsonHandlers.writeMsg(accepted, MsgThread.id(accepted.user, UserId("bob"))).asOpt[Msg],
      Some(accepted)
    )
    assert(Msg.make("", accepted.user, accepted.date).isEmpty)

  test("an attachment-free board message keeps its starting ply and per-position marks in storage"):
    import BsonHandlers.given
    import lila.db.dsl.{ *, given }
    val frames = Vector(
      MsgBoard.Frame("root", 2, "red", None, false, false, false, Vector.empty),
      MsgBoard.Frame(
        "next",
        3,
        "black",
        Some("h3e3"),
        false,
        false,
        false,
        Vector(MsgBoard.Shape("h3", Some("e3"), "green"), MsgBoard.Shape("e3", None, "red"))
      )
    )
    val card = MsgCard(boards = Some(Vector(MsgBoard(frames, "red", 3, None, None))))
    val accepted = Msg
      .make("", UserId("alice"), java.time.Instant.EPOCH, hasBoard = true)
      .get
      .copy(card = Some(card), requestDigest = Some("proof"))
    assertEquals(
      BsonHandlers.writeMsg(accepted, MsgThread.id(accepted.user, UserId("bob"))).asOpt[Msg],
      Some(accepted)
    )
