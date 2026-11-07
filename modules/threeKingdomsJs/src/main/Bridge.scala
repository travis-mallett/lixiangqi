package lila.threeKingdoms

import scala.scalajs.js
import scala.scalajs.js.annotation.*
import scala.scalajs.js.JSConverters.*

/** The browser uses the same compiled rules as the server. No TypeScript move generator. */
@JSExportTopLevel("ThreeKingdoms")
object Bridge:
  private def parse(value: String): Position =
    PositionCodec.read(value).fold(error => throw IllegalArgumentException(error), identity)

  @JSExport def initial(): String = PositionCodec.write(Position.initial)

  @JSExport def diagram(value: String): js.Object =
    val p = PositionEditor.read(value).fold(error => throw IllegalArgumentException(error), identity)
    js.Dynamic.literal(
      position = PositionCodec.write(p),
      turn = p.turn.color,
      active = p.active.toVector.sortBy(_.ordinal).map(_.color).toJSArray,
      controllers = p.controllers.map(_.fold[js.Any](null)(_.color)).toJSArray,
      pieces = p.board.zipWithIndex.collect { case (Some(piece), index) =>
        js.Dynamic.literal(
          location = Location.at(index).key,
          army = piece.army.color,
          role = piece.role.key,
          fallen = p.fallen(piece),
          controller = p.controller(piece).fold[js.Any](null)(_.color)
        )
      }.toJSArray
    )

  @JSExport def editDiagram(
      value: String,
      pieces: js.Array[js.Dynamic],
      turn: String,
      owners: js.Array[String | Null]
  ): String =
    val result = PositionEditor.edit(
      value,
      pieces.toVector.map(p =>
        (p.location.asInstanceOf[String], p.army.asInstanceOf[String], p.role.asInstanceOf[String])
      ),
      turn,
      owners.toVector.map(Option(_).map(_.asInstanceOf[String]))
    )
    PositionCodec.write(result.fold(error => throw IllegalArgumentException(error), identity))

  @JSExport def validateDiagram(value: String): String = PositionCodec.write(Rules.adjudicate(parse(value)))

  @JSExport def inspect(value: String): js.Object =
    val p = parse(value)
    js.Dynamic.literal(
      position = value,
      noSafeEscape = Rules.noSafeEscape(p),
      perpetualWarning = Rules.perpetualWarning(p),
      turn = p.turn.color,
      active = p.active.toVector.sortBy(_.ordinal).map(_.color).toJSArray,
      controllers = p.controllers.map(_.fold[js.Any](null)(_.color)).toJSArray,
      ply = p.ply,
      pieces = p.board.zipWithIndex.collect { case (Some(piece), index) =>
        js.Dynamic.literal(
          location = Location.at(index).key,
          army = piece.army.color,
          role = piece.role.key,
          fallen = p.fallen(piece),
          controller = p.controller(piece).fold[js.Any](null)(_.color)
        )
      }.toJSArray,
      moves = Rules.legalMoves(p).map(_.key).toJSArray,
      checked = Rules.checks(p).toVector.map(_.color).toJSArray,
      checkSources = js.Dictionary(
        Rules
          .checks(p)
          .toVector
          .map: target =>
            val armies = p.active.toVector
              .flatMap(owner =>
                Rules
                  .pseudoMoves(p, owner)
                  .filter(m => p.general(target).contains(m.to) && owner != target)
                  .flatMap(m => p.piece(m.from).map(_.army.color))
              )
              .distinct
              .sorted
            target.color -> armies.toJSArray
        *
      ),
      lastMove = p.lastMove.fold[js.Any](null)(_.key),
      eliminated = p.eliminated
        .map(e =>
          js.Dynamic.literal(player = e.player.color, reason = e.reason.toString.toLowerCase, ply = e.ply)
        )
        .toJSArray,
      ending = p.ending.fold[js.Any](null)(e =>
        js.Dynamic.literal(
          reason = e.reason.toString,
          winners = e.winners.toVector.map(_.color).toJSArray,
          draw = e.draw
        )
      )
    )

  @JSExport def play(value: String, move: String): String =
    val p = parse(value)
    val result = Move.parse(move).toRight("Invalid move").flatMap(Rules.play(p, _))
    PositionCodec.write(result.fold(error => throw IllegalArgumentException(error), _.position))

  @JSExport def withdraw(value: String, player: String): String =
    val result = Kingdom.fromKey(player).toRight("Invalid player").flatMap(Rules.withdraw(parse(value), _))
    PositionCodec.write(result.fold(error => throw IllegalArgumentException(error), _.position))

  @JSExport def event(value: String, actor: String, action: String): String =
    val p = parse(value)
    val player = Kingdom.fromKey(actor).getOrElse(throw IllegalArgumentException("Invalid player"))
    val result = Rules.event(p, player, action)
    PositionCodec.write(result.fold(error => throw IllegalArgumentException(error), identity))

  private def engineResult(result: Engine.Result): js.Object =
    js.Dynamic.literal(
      lines = result.lines
        .map(line =>
          js.Dynamic.literal(
            scores = line.scores.toJSArray,
            pvMoves = line.line.map(_.key).toJSArray,
            active = line.active.toVector.sortBy(_.ordinal).map(_.color).toJSArray,
            winners = line.winners.fold[js.Any](null)(_.toVector.sortBy(_.ordinal).map(_.color).toJSArray)
          )
        )
        .toJSArray,
      depth = result.depth,
      nodes = result.nodes
    )

  @JSExport def analyze(
      value: String,
      depth: Int,
      nodes: Int,
      multiPv: Int,
      emit: js.Function1[js.Object, Unit]
  ): js.Object =
    engineResult(Engine.search(parse(value), depth, nodes, multiPv, result => emit(engineResult(result))))

  /** The arrow follows the same logical path as move generation, including the horse's leg. */
  @JSExport def route(value: String, move: String): js.Array[String] =
    val p = parse(value)
    val m = Move.parse(move).getOrElse(throw IllegalArgumentException("Invalid move"))
    val piece = p.piece(m.from).getOrElse(throw IllegalArgumentException("Missing piece"))
    val route = piece.role match
      case Role.Horse =>
        Topology.horses(m.from.index).find(_.to == m.to).map(j => Vector(m.from, j.blockedAt, m.to))
      case Role.Chariot | Role.Cannon | Role.General =>
        Topology
          .rays(m.from.index)
          .find(_.contains(m.to))
          .map(ray => m.from +: ray.take(ray.indexOf(m.to) + 1))
      case _ => None
    route.getOrElse(Vector(m.from, m.to)).map(_.key).toJSArray

  @JSExport def notation(value: String, move: String): String =
    Notation(parse(value), Move.parse(move).getOrElse(throw IllegalArgumentException("Invalid move")))

  @JSExport def coordinate(location: String): String =
    Notation.square(Location.fromKey(location).getOrElse(throw IllegalArgumentException("Invalid location")))
