package lila.puzzle

import play.api.libs.json.{ JsObject, Json }

import lila.rating.Glicko
import lila.xiangqi.Xiangqi

class JsonViewTest extends munit.FunSuite:

  private val puzzle = Puzzle(
    id = PuzzleId("12345"),
    gameId = GameId("12345678"),
    gameSource = none,
    fen = Xiangqi.startFen,
    line = NonEmptyList.of(
      Xiangqi.Uci.unsafe("a4a5"),
      Xiangqi.Uci.unsafe("a7a6"),
      Xiangqi.Uci.unsafe("b1c3")
    ),
    glicko = Glicko.default,
    plays = 7,
    vote = 1f,
    themes = Set.empty
  )

  test("serializes the native Xiangqi puzzle contract"):
    val json = JsonView.puzzleJsonStandalone(puzzle)

    assertEquals((json \ "id").as[String], "12345")
    assertEquals((json \ "plays").as[Int], 7)
    assertEquals(
      (json \ "solution").as[Vector[String]],
      Vector("a7a6", "b1c3")
    )
    assertEquals((json \ "lastMove").as[String], "a4a5")
    assertEquals((json \ "state" \ "turn").as[String], "black")
    assertEquals((json \ "state" \ "ply").as[Int], 1)
    assertEquals((json \ "displayFen").as[String], puzzle.fenAfterInitialMove)
    assertEquals(puzzle.color, chess.Black)

  test("keeps the native Lila game and puzzle envelope"):
    val game: JsObject = Json.obj("id" -> puzzle.gameId.value)
    val json = JsonView.puzzleAndGamejson(puzzle, game, withInitialPos = false)

    assertEquals((json \ "variant").as[String], "xiangqi")
    assertEquals((json \ "game" \ "id").as[String], puzzle.gameId.value)
    assertEquals((json \ "puzzle" \ "initialPly").as[Int], puzzle.initialPly.value)
    assertEquals((json \ "puzzle" \ "solution").as[Vector[String]], Vector("a7a6", "b1c3"))
