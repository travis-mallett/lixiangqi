package lila.web
package ui

import lila.ui.*
import lila.ui.ScalatagsTemplate.*
import lila.core.i18n.Translate

object bits:

  object splitNumber extends NumberHelper:
    private val NumberFirstRegex = """(\d++)\s(.+)""".r
    private val NumberLastRegex = """\s(\d++)$""".r.unanchored

    def apply(s: Frag)(using ctx: Context)(using Translate): Frag =
      if ctx.blind then s
      else
        val rendered = s.render
        rendered match
          case NumberFirstRegex(number, html) =>
            frag(
              strong((~number.toIntOption).localize),
              br,
              raw(html)
            )
          case NumberLastRegex(n) if rendered.length > n.length + 1 =>
            frag(
              raw(rendered.dropRight(n.length + 1)),
              br,
              strong((~n.toIntOption).localize)
            )
          case h => raw(h.replaceIf('\n', "<br>"))

  val connectLinks: Frag = div(cls := "connect-links")(
    a(
      href := "https://github.com/travis-mallett/lixiangqi",
      targetBlank,
      noFollow
    )("GitHub"),
    a(href := "https://discord.gg/wCdGwFyCh", targetBlank, noFollow)("Discord")
  )

  val logo = raw:
    """<svg class="lichess-logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="25" cy="25" r="22"/><circle cx="25" cy="25" r="16"/><path d="M17 16h16M17 34h16M18 18l14 14M32 18 18 32M25 13v24"/></g></svg>"""
