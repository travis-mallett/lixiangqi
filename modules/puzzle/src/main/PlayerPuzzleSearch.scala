package lila.puzzle

import lila.core.userId.UserStr

final case class PlayerPuzzleSearch(query: String, userName: Option[UserStr])

object PlayerPuzzleSearch:
  def from(raw: Option[String]): PlayerPuzzleSearch =
    val query = raw.fold("")(_.trim)
    PlayerPuzzleSearch(query, UserStr.read(query))
