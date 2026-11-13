package lila.puzzle

import lila.core.userId.{ UserId, UserStr }

final case class PlayerPuzzleSearch(query: String, userName: Option[UserStr]):
  def resolve[A](currentUser: Option[A])(lookup: UserId => Fu[Option[A]]): Fu[Option[A]] =
    if query.isEmpty then fuccess(currentUser)
    else userName.flatMap(_.validateId).fold(fuccess(Option.empty[A]))(lookup)

object PlayerPuzzleSearch:
  def from(raw: Option[String]): PlayerPuzzleSearch =
    val query = raw.fold("")(_.trim)
    PlayerPuzzleSearch(query, UserStr.read(query))
