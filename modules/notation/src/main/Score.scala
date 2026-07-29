package lila.notation

case class Score(
    _id: UserId,
    redPerspectiveMoveFromNotation: List[Int] = Nil,
    blackPerspectiveMoveFromNotation: List[Int] = Nil,
    bothPerspectivesMoveFromNotation: List[Int] = Nil,
    redPerspectiveWriteNotation: List[Int] = Nil,
    blackPerspectiveWriteNotation: List[Int] = Nil,
    bothPerspectivesWriteNotation: List[Int] = Nil
)
