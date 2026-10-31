package lila.ui

/** Native variant symbols rendered by the shared variant-icon styles, including data-icon consumers. */
object VariantIcon:
  def apply(variant: lila.xiangqi.GameVariant): Icon = Icon(variant.symbol)
