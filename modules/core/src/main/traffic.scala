package lila.core
package traffic

import lila.core.userId.UserId

/** Domain observations are published after successful operations. Subscribers must never block the owner. */
case class TrafficEvent(
    id: String,
    kind: String,
    at: java.time.Instant,
    userId: Option[UserId] = None,
    correlation: Option[String] = None,
    dimensions: Map[String, String] = Map.empty,
    values: Map[String, Long] = Map.empty
)

object TrafficEvent:
  def validAttempt(value: String): Boolean = value.matches("[a-zA-Z0-9_-]{8,80}")

/** Travels with a queue entry so reconnections and delayed pairings keep the original clock. */
case class TrafficSearch(id: String, startedAt: java.time.Instant):
  def event(kind: String, user: Option[UserId], pool: String, outcome: String): TrafficEvent =
    val now = java.time.Instant.now()
    TrafficEvent(
      s"search/$id/$kind",
      s"search.$kind",
      now,
      user,
      Some(id),
      Map("pool" -> pool, "outcome" -> outcome),
      Map("durationMs" -> math.max(0L, java.time.Duration.between(startedAt, now).toMillis))
    )
