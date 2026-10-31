package lila.threeKingdoms

/** Complete position format shared by the JVM, browser, exports, and saved analysis. Unlike ordinary FEN it
  * records original armies, controllers, eliminations, and repetition.
  */
object PositionCodec:
  val version = "TK1"

  def write(p: Position): String =
    (Vector(
      version,
      p.turn.ordinal.toString,
      p.controllers.map(_.fold("-")(_.ordinal.toString)).mkString,
      Kingdom.values.filter(p.active.contains).map(_.ordinal).mkString,
      p.ply.toString,
      p.quietPlies.toString,
      p.ending.fold("-")(e => s"${e.reason.ordinal}:${if e.draw then 1 else 0}"),
      p.eliminated.map(e => s"${e.player.ordinal}:${e.reason.ordinal}:${e.ply}").mkString(","),
      p.lastMove.fold("-")(_.key),
      p.board.zipWithIndex
        .collect { case (Some(piece), index) =>
          s"${Integer.toString(index, 36)}:${piece.army.ordinal}${piece.role.code}"
        }
        .mkString(","),
      p.repetitions.mkString(",")
    ) ++ (Vector(
      p.stalemateCredit.map(_.fold("-")(_.ordinal.toString)).mkString,
      p.checkHistory
        .map((actor, targets) =>
          s"${actor.ordinal}:${targets.toVector.sortBy(_.ordinal).map(_.ordinal).mkString}"
        )
        .mkString(",")
    ))).mkString(";")

  def read(value: String): Either[String, Position] =
    if value.length > 10000 then Left("Three Kingdoms position is too long")
    else
      scala.util
        .Try:
          val f = value.split(";", -1)
          require(f(0) == version && f.length == 13, "Unsupported Three Kingdoms position")
          def player(s: String): Kingdom = Kingdom.values(s.toInt)
          require(f(2).matches("[012-]{3}"), "Invalid controllers")
          require(f(3).matches("0?1?2?"), "Invalid active players")
          val controllers = f(2).toVector.map(c => if c == '-' then None else Some(player(c.toString)))
          val active = f(3).toSet.map(c => player(c.toString))
          val eliminated = if f(7).isEmpty then Vector.empty
          else
            f(7)
              .split(',')
              .toVector
              .map: entry =>
                val e = entry.split(':')
                require(e.length == 3, "Invalid elimination")
                Elimination(player(e(0)), LossReason.values(e(1).toInt), e(2).toInt)
          val entries = if f(9).isEmpty then Vector.empty
          else
            f(9)
              .split(',')
              .toVector
              .map: entry =>
                val e = entry.split(':')
                require(e.length == 2 && e(1).length == 2, "Invalid piece")
                val index = Integer.parseInt(e(0), 36)
                require(index >= 0 && index < 135, "Invalid location")
                index -> Piece(player(e(1).head.toString), Role.fromCode(e(1).last).get)
          require(entries.map(_._1).distinct.size == entries.size, "Duplicate piece location")
          val pieces = entries.toMap
          val ending = Option.when(f(6) != "-"):
            val e = f(6).split(':')
            require(e.length == 2 && Set("0", "1").contains(e(1)), "Invalid ending")
            Ending(EndReason.values(e(0).toInt), active, e(1) == "1")
          val last = if f(8) == "-" then None else Some(Move.parse(f(8)).get)
          val repetitions = if f(10).isEmpty then Vector.empty else f(10).split(',').toVector
          require(f(11).matches("[012-]{3}"), "Invalid stalemate credit")
          val position = Position(
            Vector.tabulate(135)(pieces.get),
            player(f(1)),
            controllers,
            active,
            eliminated,
            f(4).toInt,
            f(5).toInt,
            last,
            ending,
            repetitions,
            f(11).toVector.map(c => if c == '-' then None else Some(player(c.toString))),
            if f(12).isEmpty then Vector.empty
            else
              f(12)
                .split(',')
                .toVector
                .map: entry =>
                  require(entry.matches("[012]:0?1?2?"), "Invalid check history")
                  player(entry.head.toString) -> entry.drop(2).map(c => player(c.toString)).toSet
          )
          validate(position).fold(error => throw IllegalArgumentException(error), identity)
        .toEither
        .left
        .map(_ => "Invalid Three Kingdoms position")

  def validate(p: Position): Either[String, Position] =
    val maxima = Map(
      Role.General -> 1,
      Role.Advisor -> 2,
      Role.Elephant -> 2,
      Role.Horse -> 2,
      Role.Chariot -> 2,
      Role.Cannon -> 2,
      Role.Soldier -> 5
    )
    val counts = p.board.flatten.groupMapReduce(piece => piece.army -> piece.role)(_ => 1)(_ + _)
    val valid = p.board.size == 135 && p.controllers.size == 3 && p.active.nonEmpty &&
      p.active.contains(p.turn) && p.controllers.flatten.forall(p.active.contains) &&
      p.board.flatten.forall(piece => p.controller(piece).isDefined) &&
      p.active.forall(k => p.controllers(k.ordinal).contains(k) && p.general(k).isDefined) &&
      counts.forall { case ((_, role), count) => count <= maxima(role) } &&
      p.eliminated.map(_.player).toSet == Kingdom.values.toSet -- p.active &&
      p.eliminated.map(_.player).distinct.size == p.eliminated.size &&
      p.eliminated.forall(e => e.ply >= 0 && e.ply <= p.ply) &&
      p.ply >= 0 && p.ply <= 100000 && p.quietPlies >= 0 && p.quietPlies <= 180 &&
      p.stalemateCredit.size == 3 &&
      p.stalemateCredit.flatten.forall(p.active.contains) &&
      p.checkHistory.forall((actor, targets) =>
        p.active.contains(actor) && targets.subsetOf(p.active - actor)
      ) &&
      p.checkHistory.size == (p.repetitions.size - 1).max(0) &&
      p.repetitions.size <= 181 &&
      p.repetitions.forall(_.matches("[0-9a-f]{16}")) &&
      p.repetitions.lastOption.forall(_ == repetitionKey(p)) &&
      (p.finished || p.active.size >= 2) &&
      p.ending.forall(e => e.winners == p.active && (e.draw || p.active.size == 1)) &&
      p.board.zipWithIndex.forall:
        case (Some(piece), index) =>
          val location = Location.at(index)
          piece.role match
            case Role.General => location.palace
            case Role.Advisor =>
              location.territory == piece.army && location.palace &&
              ((location.file == 4 && location.rank == 1) || (location.file != 4 && location.rank != 1))
            case Role.Elephant =>
              location.territory == piece.army &&
              Set((2, 0), (6, 0), (0, 2), (4, 2), (8, 2), (2, 4), (6, 4)).contains(
                location.file -> location.rank
              )
            case _ => true
        case _ => true
    Either.cond(valid, p, "Invalid Three Kingdoms position invariants")

  /** A stable 64-bit position identity; clocks and move counters do not affect repetition. */
  def repetitionKey(p: Position): String =
    var hash = -3750763034362895579L
    def add(value: Int): Unit = hash = (hash ^ value.toLong) * 1099511628211L
    p.board.foreach(piece => add(piece.fold(0)(x => 1 + x.army.ordinal * 7 + x.role.ordinal)))
    add(p.turn.ordinal)
    p.controllers.foreach(owner => add(owner.fold(0)(_.ordinal + 1)))
    Kingdom.values.foreach(k => add(if p.active.contains(k) then 1 else 0))
    p.stalemateCredit.foreach(owner => add(owner.fold(0)(_.ordinal + 1)))
    val value = java.lang.Long.toHexString(hash)
    "0" * (16 - value.length) + value
