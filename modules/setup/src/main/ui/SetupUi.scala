package lila.setup
package ui

import chess.variant.Variant
import play.api.data.Field

import lila.ui.*

import ScalatagsTemplate.{ *, given }

/** Shared setup controls retained for variant-aware tournament, Swiss, and simul forms. */
final class SetupUi(helpers: Helpers):
  import helpers.*

  def setupCheckboxes(
      field: Field,
      options: Seq[(Any, String, Option[String])],
      checks: Set[String] = Set.empty
  ): Frag =
    options.mapWithIndex { case ((value, text, hint), index) =>
      val id = s"setup-${field.name}-$index"
      div(cls := "checkable")(
        form3.nativeCheckbox(
          fieldId = id,
          fieldName = s"${field.name}[$index]",
          checks(value.toString),
          value.toString
        ),
        label(title := hint, `for` := id)(raw(text))
      )
    }

  private type SelectChoice = (String, String, Option[String])

  private val selectableVariants: List[Variant] = List(chess.variant.Standard)

  private def variantTuple(encode: Variant => String)(variant: Variant)(using Translate): SelectChoice =
    (encode(variant), variant.variantTrans.txt(), variant.variantTitleTrans.txt().some)

  def translatedVariantChoicesWithVariantsById(using Translate): List[SelectChoice] =
    translatedVariantChoicesWithVariants(_.id.toString)

  def translatedVariantChoicesWithVariants(encode: Variant => String)(using Translate): List[SelectChoice] =
    selectableVariants.map(variantTuple(encode))
