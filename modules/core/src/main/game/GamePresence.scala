package lila.core.game

/** The homepage room occupied by a player, shared by web and native clients. */
object GamePresence:
  def apply(game: Game, pools: lila.core.pool.PoolApi): (Option[String], Option[String]) =
    val variant = game.nativeVariant
    val prefix = if variant == lila.xiangqi.GameVariant.Xiangqi then "" else variant.key + "-"
    val activity =
      if game.isBeingPlayed then
        game.source match
          case _ if game.hasAi => Some(prefix + "ai")
          case Some(Source.Ai) => Some(prefix + "ai")
          case Some(Source.Friend) => Some(prefix + "friend")
          case _ =>
            game.clockConfig
              .flatMap(pools.homepagePoolOf(_, game.moveTimeLimit, game.nativeVariant))
              .map(_.value)
              .orElse(Some("lobby"))
      else None
    val group = activity.flatMap: value =>
      val featured =
        game.clockConfig.contains(RankedGame.xiangqiClock) &&
          game.moveTimeLimit.contains(RankedGame.xiangqiMoveTime)
      Option.when(prefix.isEmpty && (value == "lobby" || (value != "ai" && value != "friend" && !featured)))(
        "other"
      )
    activity -> group
