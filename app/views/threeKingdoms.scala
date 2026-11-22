package views

import play.api.libs.json.{ Json, JsObject }
import lila.app.UiEnv.{ *, given }

object threeKingdoms:
  private val channel = lila.tv.Tv.Channel.ThreeKingdoms

  def television(champions: lila.tv.Tv.Champions)(using Context) =
    views.round
      .threeKingdoms(
        "tv",
        tvChannels = frag(
          views.tv.ui.side.channels(channel, champions, "/tv"),
          a(cls := "button button-empty", href := routes.Tv.gamesChannel(channel.key))(
            trans.site.currentGames()
          )
        ).some
      )
      .css("bits.tv.single", "threeKingdoms")

  def tvGames(
      champions: lila.tv.Tv.Champions,
      live: List[lila.threeKingdoms.KingdomGame],
      recent: List[lila.threeKingdoms.GamePreview],
      baseUrl: String
  )(using Context) =
    def card(game: lila.threeKingdoms.GamePreview): Frag =
      a(href := s"/three-kingdoms/game/${game.id.value}")(
        div(attr("data-three-kingdoms-position") := lila.threeKingdoms.PositionCodec.write(game.position)),
        game.seats.zipWithIndex.map: (seat, index) =>
          div(
            seat.userId.fold[Frag](if seat.guest then trans.site.anonymous()
            else frag(trans.site.computer(), " ", seat.aiLevel))(id => titleNameOrId(id)),
            game.position
              .placement(lila.threeKingdoms.Kingdom.values(index))
              .map(place => frag(" · ", trans.threeKingdoms.place(place)))
          )
      )
    val liveIds = live.map(_.id).toSet
    views.tv.ui
      .gamesPage(
        channel,
        champions,
        baseUrl,
        live.map(g => card(lila.threeKingdoms.GamePreview(g.id, g.position, g.seats))),
        recent.filterNot(g => liveIds(g.id)).map(card),
        trans.site.recentGames()
      )
      .js(esmInit("threeKingdoms.mini"))

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

  def page(mode: String, data: JsObject = Json.obj())(using ctx: Context) =
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
        main(
          id := "three-kingdoms",
          cls := "three-kingdoms box"
        )(
          h1(trans.site.threeKingdoms()),
          scalatags.Text.tags2.noscript(trans.threeKingdoms.javascriptRequired())
        )
      )
