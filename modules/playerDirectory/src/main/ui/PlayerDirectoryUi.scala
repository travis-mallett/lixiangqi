package lila.playerDirectory
package ui

import scalalib.paginator.Paginator
import lila.core.playerDirectory.RatingCategory

import lila.ui.*
import lila.ui.ScalatagsTemplate.{ *, given }
import lila.core.i18n.I18nKey

final class PlayerDirectoryUi(helpers: Helpers)(menu: String => Context ?=> Frag):
  import helpers.{ *, given }
  import trans.{ site as trs, broadcast as trb }

  private[ui] val tcTrans: List[(RatingCategory, I18nKey, Icon)] =
    List(
      (RatingCategory.standard, trs.classical, Icon.Turtle),
      (RatingCategory.rapid, trs.rapid, Icon.Rabbit),
      (RatingCategory.blitz, trs.blitz, Icon.Fire)
    )

  private[ui] def page(title: String, active: String, pageMods: Update[Page] = identity)(
      modifiers: Modifier*
  )(using
      Context
  ): Page =
    val editor = Granter.opt(_.DirectoryPlayer)
    Page(title)
      .css("playerDirectory")
      .css(editor.option("directoryPlayerForm"))
      .js(infiniteScrollEsmInit)
      .js(esmInit("directoryPlayerFollow"))
      .js(editor.option(esmInit("directoryPlayerForm")))
      .pipe(pageMods):
        main(cls := "page-menu")(
          menu(active),
          div(cls := "page-menu__content box")(modifiers)
        )

  object federation:

    def index(feds: Paginator[Federation])(using Context) =
      def ratingCell(stats: lila.core.playerDirectory.Federation.Stats) =
        td(if stats.top10Rating > 0 then stats.top10Rating else "-")
      page(trb.playerFederations.txt(), "federations")(
        cls := "directory-federations",
        boxTop(h1(trb.playerFederations())),
        table(cls := "slist slist-pad")(
          thead:
            tr(
              th(trs.name()),
              th(trs.players()),
              th(trs.classical()),
              th(trs.rapid()),
              th(trs.blitz())
            )
          ,
          tbody(cls := "infinite-scroll")(
            feds.currentPageResults.map: fed =>
              tr(cls := "paginated")(
                td(
                  a(href := routes.PlayerDirectory.federation(fed.slug))(
                    flag(fed.id, none),
                    Federation.i18nName(fed.id)
                  )
                ),
                td(fed.nbPlayers.localize),
                ratingCell(fed.standard),
                ratingCell(fed.rapid),
                ratingCell(fed.blitz)
              ),
            pagerNextTable(feds, np => routes.PlayerDirectory.federations(np).url)
          )
        )
      )

    def show(fed: Federation, playersList: Frag)(using Context) =
      page(s"${fed.name} - ${trb.playerFederations.txt()}", "federations")(
        cls := "directory-federation",
        div(cls := "box__top directory-federation__head")(
          flag(fed.id, none),
          div(
            h1(Federation.i18nName(fed.id)),
            p(trs.nbPlayers.plural(fed.nbPlayers, fed.nbPlayers.localize))
          ),
          (fed.id.value == "KOS").option(p(cls := "directory-federation__kosovo")(kosovoText))
        ),
        div(cls := "directory-cards directory-federation__cards box__pad")(
          tcTrans.map: (tc, name, icon) =>
            val stats = fed.stats(tc)
            card(
              em(dataIcon := icon, cls := "text")(name()),
              frag(
                p(trs.rank(), strong(stats.get.rank)),
                p(trb.top10Rating(), strong(stats.get.top10Rating)),
                p(trs.players(), strong(stats.get.nbPlayers.localize))
              )
            )
        ),
        playersList
      )

    private val kosovoText =
      """All reference to Kosovo, whether to the territory, institutions or population, in this text shall be understood in full compliance with United Nations Security Council Resolution 1244 and without prejudice to the status of Kosovo"""

    def flag(id: lila.core.playerDirectory.Federation.Id, title: Option[String]) = img(
      cls := "flag",
      st.title := title.getOrElse(id.value),
      src := playerFederationSrc(id)
    )

    private def playerFederationSrc(playerFederation: lila.core.playerDirectory.Federation.Id): Url =
      staticAssetUrl(s"$playerFederationVersion/images/federations/${playerFederation}.webp")

    private def card(name: Frag, value: Frag) =
      div(cls := "directory-card directory-federation__card")(name, div(value))
