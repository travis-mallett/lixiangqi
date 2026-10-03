package lila.playerDirectory
package ui

import scalalib.paginator.Paginator

import lila.core.playerDirectory.DirectoryPlayerOrder
import lila.ui.*
import lila.ui.ScalatagsTemplate.{ *, given }
import lila.core.id.ImageId

final class DirectoryPlayerUi(
    helpers: Helpers,
    directoryUi: PlayerDirectoryUi,
    picfitUrl: lila.memo.PicfitUrl
):
  import helpers.{ *, given }
  import trans.{ site as trs, broadcast as trb }

  def index(players: Paginator[DirectoryPlayer.WithFollow], query: String, order: DirectoryPlayerOrder)(using
      Context
  ) =
    directoryUi.page(trb.directoryPlayers.txt(), "players")(
      cls := "directory-players",
      boxTop(
        h1(trb.directoryPlayers()),
        div(cls := "box__top__actions"):
          searchForm(query)
      ),
      playerList(
        players,
        order,
        np => routes.PlayerDirectory.index(np, query.nonEmptyOption),
        sortable = query.isEmpty
      )
    )

  def notFound(id: lila.core.playerDirectory.PlayerId)(using Context) =
    directoryUi.page(trb.directoryPlayerNotFound.txt(), "players")(
      cls := "directory-players",
      boxTop(
        h1(trb.directoryPlayerNotFound()),
        div(cls := "box__top__actions"):
          searchForm("")
      ),
      div(cls := "box__pad")(
        p(trb.directoryUnavailable()),
        p(strong(id.value))
      )
    )

  def searchForm(q: String) =
    st.form(
      cls := "directory-players__search-form",
      action := routes.PlayerDirectory.index(),
      method := "get"
    )(
      input(
        cls := "directory-players__search-form__input",
        name := "q",
        st.placeholder := "Search for players",
        st.value := q,
        autofocus := true,
        autocomplete := "off",
        spellcheck := "false"
      ),
      submitButton(cls := "button", dataIcon := Icon.Search)
    )

  def playerList(
      players: Paginator[DirectoryPlayer.WithFollow],
      order: DirectoryPlayerOrder,
      url: Int => Call,
      sortable: Boolean
  )(using ctx: Context) =
    def header(label: Frag, o: DirectoryPlayerOrder) =
      if sortable then
        val current = o == order
        th(
          a(
            href := current.not.option(addQueryParam(url(1).url, "order", o.key)),
            cls := List("active" -> current)
          )(label)
        )
      else th(label)
    div(cls := "slist-wrapper")(
      table(
        cls := List(
          "slist slist-pad directory-players-table" -> true,
          "directory-players-table--sortable" -> sortable
        )
      )(
        thead:
          tr(
            header(trs.name(), DirectoryPlayerOrder.name),
            header(trs.classical(), DirectoryPlayerOrder.standard),
            header(trs.rapid(), DirectoryPlayerOrder.rapid),
            header(trs.blitz(), DirectoryPlayerOrder.blitz),
            header(trb.age(), DirectoryPlayerOrder.year),
            ctx.isAuth.option(header(trs.follow(), DirectoryPlayerOrder.follow))
          )
        ,
        tbody(cls := "infinite-scroll")(
          players.currentPageResults.map: p =>
            val player = p.player
            val link = a(href := routes.PlayerDirectory.show(player.id, player.slug))
            tr(cls := "paginated")(
              td(cls := "player-intro-td")(
                span(cls := "player-intro")(
                  link(cls := "player-intro__photo"):
                    player.photo
                      .fold(
                        thumbnail.fallback(
                          cls := "directory-players__photo directory-players__photo--fallback"
                        )
                      ): photo =>
                        img(src := thumbnail.url(photo.id, _.Small), cls := "directory-players__photo")
                  ,
                  span(cls := "player-intro__info")(
                    link(cls := "player-intro__name")(
                      player.title.map(t => span(cls := "utitle")(t.value)),
                      player.name
                    ),
                    player.fed.map: fed =>
                      span(cls := "player-intro__fed")(
                        directoryUi.federation.flag(fed, none),
                        Federation.i18nName(fed)
                      )
                  )
                )
              ),
              td(player.standard),
              td(player.rapid),
              td(player.blitz),
              td(player.age),
              ctx.isAuth.option(td(followButton(p)))
            )
          ,
          pagerNextTable(players, np => addQueryParam(url(np).url, "order", order.key))
        )
      )
    )
  private def followButton(p: DirectoryPlayer.WithFollow) =
    val id = s"directory-player-follow-${p.player.id}"
    label(cls := "directory-player__follow")(
      form3.cmnToggle(
        fieldId = id,
        fieldName = id,
        checked = p.follow,
        action = Some(routes.PlayerDirectory.follow(p.player.id, p.follow).url),
        cssClass = "cmn-favourite"
      )
    )

  def show(
      player: DirectoryPlayer,
      user: Option[User],
      tours: Option[Frag],
      ratings: DirectoryRatingHistory,
      isFollowing: Boolean
  )(using ctx: Context) =
    directoryUi.page(
      s"${player.name} - ${trb.directoryPlayers.txt()}",
      "players",
      _.js(esmInit("directoryRatingChart", ratings.toJson))
    )(
      cls := "box-pad directory-player",
      div(cls := "directory-player__header")(
        player.photo.map: photo =>
          div(cls := "directory-player__photo")(
            img(src := thumbnail.url(photo.id, _.Medium)),
            photo.credit.map: credit =>
              span(cls := "directory-player__photo__credit")("Credit: ", credit)
          ),
        div(cls := "directory-player__header__info")(
          h1(cls := "directory-player__header__name")(
            span(player.title.map(t => span(cls := "utitle")(t.value)), player.name),
            user.map(userLink(_, withTitle = false))
          ),
          ctx.isAuth.option(
            followButton(DirectoryPlayer.WithFollow(player, isFollowing))(trans.site.follow())
          ),
          table(cls := "directory-player__header__table")(
            tbody(
              player.fed.map: fed =>
                tr(
                  th(trb.federation()),
                  td(
                    a(
                      cls := "directory-player__federation",
                      href := routes.PlayerDirectory.federation(Federation.idToSlug(fed))
                    )(
                      directoryUi.federation.flag(fed, none),
                      Federation.i18nName(fed)
                    )
                  )
                ),
              tr(
                th(trb.directoryProfile()),
                td(player.id)
              ),
              tr(
                th(trb.playerSource()),
                td(a(href := player.provenance.url, targetBlank)(player.provenance.provider.toUpperCase))
              ),
              tr(th(trb.playerSourceDate()), td(player.provenance.publishedAt)),
              player.age.map: age =>
                tr(
                  th(trb.age()),
                  td(
                    age,
                    for by <- player.year; dy <- player.deceasedYear
                    yield s" ($by - $dy)"
                  )
                )
            )
          )
        )
      ),
      Granter.opt(_.DirectoryPlayer).option(photoForm(player)),
      div(cls := "directory-player__ratings")(
        directoryUi.tcTrans.map: (tc, name, icon) =>
          div(cls := "directory-player__rating")(
            div(cls := "directory-player__rating__text")(
              em(dataIcon := icon, cls := "text")(name()),
              strong(player.ratingOf(tc).fold(trb.unrated())(_.toString))
            ),
            canvas(cls := s"directory-player__rating__history directory-player__rating__history--$tc")
          )
      ),
      tours.map: tours =>
        div(cls := "directory-player__tours")(h2(trb.recentTournaments()), tours)
    )

  object thumbnail:
    def apply(image: Option[ImageId], size: DirectoryPlayer.PlayerPhoto.SizeSelector): Tag =
      image.fold(fallback): id =>
        img(src := url(id, size))
    def fallback = img(src := staticAssetUrl("images/anon-face.webp"))
    def url(id: ImageId, size: DirectoryPlayer.PlayerPhoto.SizeSelector) =
      DirectoryPlayer.PlayerPhoto(picfitUrl, id, size)

  private def photoForm(player: DirectoryPlayer)(using ctx: Context) =
    val credit = lila.playerDirectory.DirectoryPlayer.form.credit(player)
    form3.fieldset("Photo", toggle = player.photo.isEmpty.some)(
      postForm(
        cls := "form3 directory-player__form",
        action := routes.PlayerDirectory.playerUpdate(player.id)
      )(
        form3.split(
          div(
            cls := "form-group form-half directory-player__photo-edit",
            data("post-url") := routes.PlayerDirectory.playerPhoto(player.id)
          )(
            p(
              "Portrait of the player. It should be recognizable even at small sizes. ",
              strong(trans.streamer.maxSize(s"${lila.memo.PicfitApi.uploadMaxMb}MB."))
            ),
            form3.file.selectImage()
          ),
          form3.group(credit("photo.credit"), trans.ublog.imageCredit(), half = true)(form3.input(_))
        ),
        form3.action(form3.submit("Save"))
      )
    )
