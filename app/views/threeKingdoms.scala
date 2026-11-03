package views

import play.api.libs.json.{ Json, JsObject }
import lila.app.UiEnv.{ *, given }

object threeKingdoms:
  def television(mode: String, champions: lila.tv.Tv.Champions)(using Context) =
    if mode == "tv" then
      views.round
        .threeKingdoms(
          mode,
          tvChannels = frag(
            views.tv.ui.side.channels(lila.tv.Tv.Channel.ThreeKingdoms, champions, "/tv"),
            a(cls := "button button-empty", href := routes.Tv.gamesChannel("threeKingdoms"))(
              trans.site.currentGames()
            )
          ).some
        )
        .css("bits.tv.single", "threeKingdoms")
    else
      page(mode, embedded = true)
        .css("bits.tv.games")
        .wrap(content =>
          main(cls := "page-menu tv-games")(
            scalatags.Text.tags2.aside(cls := "page-menu__menu")(
              views.tv.ui.side.channels(lila.tv.Tv.Channel.ThreeKingdoms, champions, "/games")
            ),
            div(cls := "page-menu__content")(content)
          )
        )

  def embed(using EmbedContext) =
    views.base.embed.minimal(
      title = trans.site.threeKingdoms.txt(),
      cssKeys = List("threeKingdoms.embed"),
      modules = Esm("threeKingdoms.embed")
    )(
      a(
        id := "three-kingdoms-embed",
        cls := "three-kingdoms-embed",
        href := "/tv/threeKingdoms",
        targetBlank,
        attr("data-computer-label") := trans.site.computer.txt(),
        attr("data-guest-label") := trans.site.anonymous.txt()
      )(p(role := "status")(trans.site.noGameFound()))
    )

  def widget(game: lila.threeKingdoms.KingdomGame)(using Context): Frag =
    val hrefGame = s"/three-kingdoms/game/${game.id.value}"
    div(cls := "game-row paginated three-kingdoms-history")(
      a(cls := "game-row__overlay", href := hrefGame, title := trans.site.threeKingdoms.txt()),
      div(
        cls := "game-row__board",
        attr("data-three-kingdoms-position") := lila.threeKingdoms.PositionCodec.write(game.position)
      ),
      div(cls := "game-row__infos")(
        strong(trans.site.threeKingdoms()),
        div(game.seats.zipWithIndex.map: (seat, index) =>
          div(
            seat.userId.fold[Frag](if seat.guest then trans.site.anonymous() else trans.site.computer())(id =>
              userIdLink(id.some)
            ),
            game.position
              .placement(lila.threeKingdoms.Kingdom.values(index))
              .map(place => span(" · ", trans.threeKingdoms.place(place)))
          )),
        momentFromNow(game.createdAt)
      )
    )

  def page(mode: String, data: JsObject = Json.obj(), embedded: Boolean = false)(using ctx: Context) =
    Page(trans.site.threeKingdoms.txt())
      .css("threeKingdoms")
      .i18n(_.threeKingdoms)
      .i18n(_.study)
      .js(
        PageModule(
          "threeKingdoms",
          data ++ Json.obj(
            "mode" -> mode,
            "me" -> ctx.userId.map(_.value),
            "preferences" -> Json.obj(
              "animationDuration" -> ctx.pref.animationMillis,
              "moveEvent" -> ctx.pref.moveEvent,
              "highlight" -> ctx.pref.highlight
            )
          )
        )
      )
      .flag(_.zoom)
      .body(
        (if embedded then scalatags.Text.tags2.section else main) (
          id := "three-kingdoms",
          cls := "three-kingdoms box"
        )(
          h1(trans.site.threeKingdoms()),
          scalatags.Text.tags2.noscript(trans.threeKingdoms.javascriptRequired())
        )
      )
