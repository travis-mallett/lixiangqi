package lila.threeKingdoms

class PositionEditorTest extends munit.FunSuite:
  private val initial = PositionCodec.write(Position.initial)
  private def pieces(position: Position) = position.board.zipWithIndex.collect:
    case (Some(piece), index) => (Location.at(index).key, piece.army.color, piece.role.key)
  private val owners = Kingdom.values.toVector.map(k => Some(k.color))

  test("an incomplete diagram round trips without becoming a valid game"):
    val empty = PositionEditor.edit(initial, Vector.empty, "red", owners).toOption.get
    val encoded = PositionCodec.write(empty)
    assertEquals(PositionEditor.read(encoded), Right(empty))
    assert(PositionCodec.read(encoded).isLeft)
    assert(PositionEditor.read(encoded.replace("TK1;2;", "TK1;9;")).isLeft)
    assert(PositionEditor.read(encoded.replace(";012;012;", ";000;012;")).isLeft)
    assert(PositionEditor.read(encoded.replace(";012;012;", ";01-;012;")).isLeft)
    assert(PositionEditor.edit(initial, Vector(("invalid", "red", "general")), "red", owners).isLeft)

  test("read preserves imported adjudication metadata; editing resets history"):
    val moved = Rules.play(Position.initial, Rules.legalMoves(Position.initial).head).toOption.get.position
    val encoded = PositionCodec.write(moved)
    assertEquals(PositionEditor.read(encoded).map(PositionCodec.write), Right(encoded))
    val edited = PositionEditor.edit(encoded, pieces(moved), moved.turn.color, owners).toOption.get
    assertEquals(edited.board, moved.board)
    assertEquals(edited.ply, moved.ply)
    assertEquals(edited.lastMove, None)
    assertEquals(edited.repetitions, Vector.empty)
    assertEquals(edited.checkHistory, Vector.empty)
    assert(PositionCodec.validate(edited).isRight)

  test("ownership changes preserve original armies and mark their general as fallen"):
    val controlled = owners.updated(Kingdom.Wu.ordinal, Some("red"))
    val edited = PositionEditor.edit(initial, pieces(Position.initial), "red", controlled).toOption.get
    assertEquals(edited.active, Set(Kingdom.Wei, Kingdom.Shu))
    assertEquals(edited.controller(Piece(Kingdom.Wu, Role.Chariot)), Some(Kingdom.Shu))
    assert(edited.fallen(Piece(Kingdom.Wu, Role.General)))
    assert(PositionCodec.read(PositionCodec.write(edited)).isRight)
    assert(PositionEditor.edit(initial, pieces(Position.initial), "green", controlled).isLeft)
    assert(
      PositionEditor
        .edit(initial, pieces(Position.initial), "red", Vector(Some("green"), Some("black"), Some("red")))
        .isLeft
    )

  test("editing a finished position preserves the elimination order"):
    val owners = Vector.fill(3)(Some("red"))
    val base = PositionEditor.edit(initial, pieces(Position.initial), "red", owners).toOption.get
    val previous = base.copy(eliminated = base.eliminated.reverse)
    val edited =
      PositionEditor.edit(PositionCodec.write(previous), pieces(previous), "red", owners).toOption.get
    assertEquals(edited.eliminated, previous.eliminated)
