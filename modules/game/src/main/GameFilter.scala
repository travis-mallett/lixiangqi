package lila.game

enum GameFilter:
  val name = toString
  case all, me, ranked, win, loss, draw, playing, bookmark, imported, search

object GameFilter:

  val list: NonEmptyList[GameFilter] =
    NonEmptyList.of(all, me, ranked, win, loss, draw, playing, bookmark, imported, search)

  def apply(name: String) =
    list.find(_.name == name) | list.head

case class GameFilterMenu(
    all: NonEmptyList[GameFilter],
    current: GameFilter
):
  def list = all.toList
