package lila.traffic

import java.time.Instant

class TrafficModelTest extends munit.FunSuite:
  private val now = Instant.parse("2026-09-24T12:00:00Z")
  private val event = ClientEvent(
    "event_123",
    "attention",
    now.toEpochMilli,
    "visit_123",
    "session_123",
    None,
    Map("board" -> lila.pref.BoardThemes.all.head.key),
    Map("engagedMs" -> 60000L)
  )
  private def batch(e: ClientEvent) = ClientBatch("browser_123", List(e))

  test("client events cannot forge server outcomes or supply arbitrary fields"):
    assert(ClientBatch.validate(batch(event), now))
    assert(!ClientBatch.validate(batch(event.copy(kind = "search.paired")), now))
    assert(!ClientBatch.validate(batch(event.copy(dimensions = Map("ip" -> "127.0.0.1"))), now))
    assert(
      !ClientBatch.validate(batch(event.copy(dimensions = Map("backgroundUrl" -> "private-image"))), now)
    )
    assert(!ClientBatch.validate(batch(event.copy(values = Map("engagedMs" -> -1L))), now))
    assert(!ClientBatch.validate(batch(event.copy(values = Map("engagedMs" -> 120001L))), now))
    assert(!ClientBatch.validate(batch(event.copy(at = now.minusSeconds(86401).toEpochMilli)), now))
    assert(!ClientBatch.validate(batch(event.copy(at = now.plusSeconds(61).toEpochMilli)), now))
    assert(!ClientBatch.validate(ClientBatch("browser_123", List.fill(21)(event)), now))

  test("every current appearance catalog option is accepted automatically"):
    for (component, choices) <- TrafficCatalog.choices; key <- choices.keys do
      assert(
        ClientBatch.validate(batch(event.copy(dimensions = Map(component -> key))), now),
        s"$component/$key"
      )

  test("uniques union identities across days instead of adding daily estimates"):
    val monday = TrafficDistinct.merge(None, List("a", "b", "c"))
    val tuesday = TrafficDistinct.merge(None, List("b", "c", "d"))
    val union = TrafficDistinct.union(List(monday, tuesday))
    assertEquals(math.round(union.getEstimate), 4L)
    assertEquals(math.round(TrafficDistinct.union(List(monday, monday)).getEstimate), 3L)
    assertEquals(math.round(TrafficDistinct.union(Nil).getEstimate), 0L)

  test("calendar buckets use UTC including leap years and Monday weeks"):
    assertEquals(TrafficTime.bucket(now, "week"), Instant.parse("2026-09-21T00:00:00Z"))
    assertEquals(
      TrafficTime.bucket(Instant.parse("2024-02-29T23:59:59Z"), "month"),
      Instant.parse("2024-02-01T00:00:00Z")
    )
    assertEquals(TrafficTime.bucket(now, "year"), Instant.parse("2026-01-01T00:00:00Z"))

  test("old hourly data remains queryable; query budgets do not expire data"):
    assert(
      TrafficFilter.read(Map("from" -> "2010-01-01", "until" -> "2010-01-03", "grain" -> "hour"), now).isRight
    )
    assert(
      TrafficFilter
        .read(Map("from" -> "2010-01-01", "until" -> "2026-01-01", "grain" -> "month"), now)
        .isRight
    )
    assert(
      TrafficFilter.read(Map("from" -> "2010-01-01", "until" -> "2026-01-01", "grain" -> "hour"), now).isLeft
    )

  test("identity keys are domain separated and stable"):
    val identity = TrafficIdentity("test-key-never-production-0123456789")
    assertEquals(identity("account", "alice"), identity("account", "alice"))
    assertNotEquals(identity("account", "alice"), identity("browser", "alice"))
    assert(!identity("account", "alice").contains("alice"))
