package lila.threeKingdoms

/** Logical paths on the approved 3 x (9 x 5) board; never inferred from screen angles. */
object Topology:
  private def local(at: Location, df: Int, dr: Int): Option[Location] =
    val f = at.file + df
    val r = at.rank + dr
    Option.when(f >= 0 && f < 9 && r >= 0 && r < 5)(Location(at.territory, f, r))

  def adjacent(at: Location): Vector[Location] =
    Vector((1, 0), (-1, 0), (0, 1), (0, -1)).flatMap((f, r) => local(at, f, r))

  /** A central file has two forward continuations, never a playable center node. */
  def across(at: Location): Vector[Location] =
    if at.rank != 4 then Vector.empty
    else
      Vector(
        Option.when(at.file <= 4)(Location(Kingdom.at(at.territory.ordinal + 1), 8 - at.file, 4)),
        Option.when(at.file >= 4)(Location(Kingdom.at(at.territory.ordinal + 2), 8 - at.file, 4))
      ).flatten

  val rays: Vector[Vector[Vector[Location]]] = Location.all.map: at =>
    val left = (at.file - 1 to 0 by -1).map(f => at.copy(file = f)).toVector
    val right = (at.file + 1 until 9).map(f => at.copy(file = f)).toVector
    val back = (at.rank - 1 to 0 by -1).map(r => at.copy(rank = r)).toVector
    val front = (at.rank + 1 until 5).map(r => at.copy(rank = r)).toVector
    val forward = across(at.copy(rank = 4)).map: bank =>
      front ++ (4 to 0 by -1).map(r => bank.copy(rank = r))
    Vector(left, right, back) ++ forward

  final case class Jump(to: Location, blockedAt: Location)

  /** Cross-river horses use the same two-step/one-step move on an unfolded shared frontier. Only the two
    * half-territories bordering that frontier belong to the chart. This prevents jumping over the central
    * divider into the third territory.
    */
  val horses: Vector[Vector[Jump]] = Location.all.map: at =>
    val deltas = Vector((1, 2), (-1, 2), (1, -2), (-1, -2), (2, 1), (2, -1), (-2, 1), (-2, -1))
    val within = deltas.flatMap: (df, dr) =>
      for
        to <- local(at, df, dr)
        leg <- local(at, if math.abs(df) == 2 then df / 2 else 0, if math.abs(dr) == 2 then dr / 2 else 0)
      yield Jump(to, leg)
    val crossing = Vector(true, false).flatMap: left =>
      val x = if left then at.file else 8 - at.file
      if x > 4 then Vector.empty
      else
        val other = Kingdom.at(at.territory.ordinal + (if left then 1 else 2))
        def chart(cx: Int, y: Int): Location =
          if y < 5 then Location(at.territory, if left then cx else 8 - cx, y)
          else Location(other, if left then 8 - cx else cx, 9 - y)
        deltas.flatMap: (dx, dy) =>
          val nx = x + dx
          val ny = at.rank + dy
          Option.when(nx >= 0 && nx <= 4 && ny >= 5 && ny < 10):
            val lx = x + (if math.abs(dx) == 2 then dx / 2 else 0)
            val ly = at.rank + (if math.abs(dy) == 2 then dy / 2 else 0)
            Jump(chart(nx, ny), chart(lx, ly))
    (within ++ crossing).distinct

  val elephants: Vector[Vector[Jump]] = Location.all.map: at =>
    Vector((2, 2), (-2, 2), (2, -2), (-2, -2)).flatMap: (df, dr) =>
      for
        to <- local(at, df, dr)
        eye <- local(at, df / 2, dr / 2)
      yield Jump(to, eye)

  val advisors: Vector[Vector[Location]] = Location.all.map: at =>
    if !at.palace then Vector.empty
    else if at.file == 4 && at.rank == 1 then
      Vector((3, 0), (5, 0), (3, 2), (5, 2)).map((f, r) => Location(at.territory, f, r))
    else if at.file != 4 && at.rank != 1 then Vector(Location(at.territory, 4, 1))
    else Vector.empty

  def soldiers(at: Location, army: Kingdom): Vector[Location] =
    if at.territory == army then if at.rank == 4 then across(at) else Vector(at.copy(rank = at.rank + 1))
    else Vector(local(at, 0, -1), local(at, -1, 0), local(at, 1, 0)).flatten
