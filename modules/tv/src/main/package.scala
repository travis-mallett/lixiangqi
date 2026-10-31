package lila.tv

export lila.core.lilaism.Lilaism.{ *, given }
export lila.common.extensions.*

private[tv] val logger = lila.log("tv")

case class RenderFeaturedJs(game: Game, promise: Promise[Html], channelKey: Option[String] = None)
