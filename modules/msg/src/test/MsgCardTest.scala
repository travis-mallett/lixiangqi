package lila.msg

import play.api.libs.json.Json
import scala.concurrent.Await

class MsgCardTest extends munit.FunSuite:
  private val alice = UserId("alice")
  private val bob = UserId("bob")
  private val poll = MsgPoll("Next game?", List("Today", "Tomorrow"), false, Nil, false)
  private val card = MsgCard(Some(poll), None, None)
  private val message = Msg("Next game?\nToday\nTomorrow", alice, nowInstant, card = Some(card))

  test("a ballot belongs to its actor and can be replaced or withdrawn until the author closes voting"):
    def act(m: Msg, who: UserId, action: String, value: String) =
      Await.result(MsgCard.pollAction(m, who, action, value), 1.second)
    val one = act(message, bob, "vote", "[0]")
    val two = act(one, bob, "vote", "[1]")
    assertEquals(two.card.flatMap(_.poll).get.votes, List(PollBallot(bob.value, List(1))))
    assert(act(two, bob, "vote", "[]").card.flatMap(_.poll).get.votes.isEmpty)
    intercept[MsgActionError](act(two, bob, "vote", "[0,1]"))
    intercept[MsgActionError](act(two, bob, "endPoll", ""))
    intercept[MsgActionError](act(act(two, alice, "endPoll", ""), bob, "vote", "[0]"))
    assert(!two.canForward)
    assertEquals(
      BsonHandlers.msgHandler.read(BsonHandlers.writeMsg(two, MsgThread.id(alice, bob))).card,
      two.card
    )

  test("send payloads cannot preload votes or attach preview metadata to a different link"):
    def accepted(c: MsgCard, text: String) =
      Await.result(MsgCard.decode(Some(Json.stringify(Json.toJson(c))), text, Nil), 1.second)
    assertEquals(accepted(card, message.text), Some(card))
    intercept[MsgActionError](accepted(card.copy(poll = Some(poll.copy(ended = true))), message.text))
    val preview = MsgCard(None, None, Some(MsgPreview("https://signal.org/blog/", "Blog", "News")))
    assertEquals(accepted(preview, "Read (https://signal.org/blog/)."), Some(preview))
    intercept[MsgActionError](accepted(preview, "https://signal.org/blog/other"))

  test("preview connections resolve to globally routable addresses"):
    for ip <- List("127.0.0.1", "10.0.0.1", "100.64.1.1", "192.168.0.1", "169.254.1.1", "::1") do
      assert(!LinkPreview.publicAddress(java.net.InetAddress.getByName(ip)))
    assert(LinkPreview.publicAddress(java.net.InetAddress.getByName("1.1.1.1")))
    for uri <- List(
        "http://signal.org",
        "https://localhost",
        "https://alice@signal.org",
        "https://127.0.0.1",
        "https://signal.org:8888"
      )
    do assert(!LinkPreview.validUrl(uri))
