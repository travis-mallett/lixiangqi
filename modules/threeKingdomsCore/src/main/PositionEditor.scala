package lila.threeKingdoms

/** Draft setups retain army ownership. Only actual edits discard move/adjudication history. */
object PositionEditor:
  def read(value: String): Either[String, Position] = PositionCodec.readDiagram(value)

  def edit(
      value: String,
      pieces: Vector[(String, String, String)],
      turn: String,
      owners: Vector[Option[String]]
  ): Either[String, Position] =
    for
      previous <- read(value)
      player <- Kingdom.fromKey(turn).toRight("Invalid player")
      controllers <- owners.foldLeft[Either[String, Vector[Option[Kingdom]]]](Right(Vector.empty)):
        (result, owner) =>
          for
            current <- result
            next <- owner.fold[Either[String, Option[Kingdom]]](Right(None))(key =>
              Kingdom.fromKey(key).toRight("Invalid controller").map(Some(_))
            )
          yield current :+ next
      _ <- Either.cond(controllers.size == 3, (), "Invalid controllers")
      active = Kingdom.values.filter(k => controllers(k.ordinal).contains(k)).toSet
      _ <- Either.cond(active.contains(player), (), "The side to move must be active")
      _ <- Either.cond(controllers.flatten.forall(active), (), "Controllers must be active players")
      entries <- pieces.foldLeft[Either[String, Map[Int, Piece]]](Right(Map.empty)):
        case (result, (key, color, role)) =>
          for
            current <- result
            location <- Location.fromKey(key).toRight("Invalid location")
            army <- Kingdom.fromKey(color).toRight("Invalid army")
            kind <- Role.values.find(_.key == role).toRight("Invalid role")
            _ <- Either.cond(!current.contains(location.index), (), "Duplicate location")
          yield current.updated(location.index, Piece(army, kind))
      retained = previous.eliminated.filterNot(e => active(e.player))
      eliminated = retained ++ Kingdom.values.toVector
        .filterNot(k => active(k) || retained.exists(_.player == k))
        .map(k => Elimination(k, LossReason.Resignation, previous.ply))
    yield Position(
      Vector.tabulate(135)(entries.get),
      player,
      controllers,
      active,
      eliminated,
      ply = previous.ply,
      ending = Option.when(active.size == 1)(Ending(EndReason.LastSurvivor, active, false))
    )
