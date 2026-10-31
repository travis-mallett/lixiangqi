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
        p(cls := "pro-players__description")(trb.catalogPlayerDescription()),
        div(cls := "box__top__actions"):
          searchForm(query)
      ),
      players.currentPageResults.isEmpty.option(
        div(cls := "box__pad", role := "status")(
          p(trb.noPlayersFound()),
          query.nonEmpty.option(
            a(cls := "button button-empty", href := routes.PlayerDirectory.index())(trs.clearSearch())
          )
        )
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
  def searchForm(q: String)(using Context) =
    st.form(
      cls := "directory-players__search-form",
      action := routes.PlayerDirectory.index(),
      method := "get"
    )(
      input(
        cls := "directory-players__search-form__input",
        name := "q",
        st.placeholder := trb.searchPlayers.txt(),
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
    frag(
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
              header(trb.catalogGames(), DirectoryPlayerOrder.games),
              header(trb.catalogScore(), DirectoryPlayerOrder.score),
              th(trb.catalogLastSeen()),
              ctx.isAuth.option(header(trs.follow(), DirectoryPlayerOrder.follow))
            )
          ,
          tbody(
            players.currentPageResults.map: p =>
              val player = p.player
              val link = a(href := routes.PlayerDirectory.show(player.id, player.slug))
              tr(
                td(cls := "player-intro-td")(
                  span(cls := "player-intro")(
                    link(cls := "player-intro__photo"):
                      player.photo
                        .fold(
                          thumbnail.fallback(
                            cls := "directory-players__photo directory-players__photo--fallback"
                          )
                        ): photo =>
                          img(
                            src := thumbnail.url(photo, _.Small),
                            cls := "directory-players__photo",
                            alt := "",
                            attr("loading") := "lazy"
                          )
                    ,
                    span(cls := "player-intro__info")(
                      link(cls := "player-intro__name")(
                        player.title.map(t => frag(span(cls := "utitle")(t.value), " ")),
                        player.displayName
                      ),
                      player.team
                        .orElse(player.stats.team)
                        .map(team =>
                          span(cls := "player-intro__team", title := trb.lastRecordedTeam.txt())(team)
                        ),
                      player.fed.map: fed =>
                        span(cls := "player-intro__fed")(
                          directoryUi.federation.flag(fed, none),
                          Federation.i18nName(fed)
                        )
                    )
                  )
                ),
                td(player.stats.games.localize),
                td(if player.stats.games == 0 then "—"
                else
                  s"${math.round(100.0 * (player.stats.wins + player.stats.draws * 0.5) / player.stats.games)}%"),
                td(player.stats.lastPlayedAt.map(_.take(4))),
                ctx.isAuth.option(td(followButton(p)))
              )
          )
        )
      ),
      players.hasToPaginate.option(
        st.nav(cls := "directory-players__pagination")(
          (players.currentPage > 1).option(
            a(
              cls := "button button-empty",
              href := addQueryParam(url(players.currentPage - 1).url, "order", order.key)
            )(trs.previous())
          ),
          span(s"${players.currentPage} / ${players.nbPages}"),
          players.nextPage.map(np =>
            a(
              cls := "button button-empty",
              rel := "next",
              href := addQueryParam(url(np).url, "order", order.key)
            )(trs.next())
          )
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
  def profile(player: DirectoryPlayer, isFollowing: Boolean, user: Option[User])(using ctx: Context): Frag =
    val lang = ctx.lang.code
    val biography = player.biography
      .get(lang)
      .orElse(player.biography.get(ctx.lang.language))
      .orElse(player.biography.get("en"))
    val recordedTeam = player.stats.team.map(_ -> player.stats.teamAsOf)
    frag(
      div(cls := "pro-player-profile")(
        div(cls := "pro-player-profile__portrait")(
          player.photo.fold(thumbnail.fallback): photo =>
            frag(
              img(src := thumbnail.url(photo, _.Medium), alt := player.displayName.value),
              photo.credit.map: credit =>
                small(
                  photo.sourceUrl.fold[Frag](frag(credit))(url => a(href := url, targetBlank)(credit))
                )
            )
        ),
        div(cls := "pro-player-profile__facts")(
          div(cls := "pro-player-profile__identity")(
            player.title.map(t => span(cls := "utitle")(t.value)),
            player.aliases.map(n => span(n.value)),
            user.map(userLink(_, withTitle = false)),
            ctx.isAuth.option(followButton(DirectoryPlayer.WithFollow(player, isFollowing)))
          ),
          player.fed.map(fed => p(directoryUi.federation.flag(fed, none), Federation.i18nName(fed))),
          player.titles.map: award =>
            p(
              if award.status == "revoked" then trb.revokedTitle() else trb.recordedTitle(),
              ": ",
              strong(s"${award.issuer} ${award.code}"),
              " · ",
              a(href := award.source.url, targetBlank)(award.source.publishedAt),
              award.statusSource.map(s => frag(" · ", a(href := s.url, targetBlank)(s.publishedAt)))
            ),
          player.team.map: team =>
            p(trb.registeredTeam(), ": ", team, player.teamAsOf.map(date => small(s" (${date.take(10)})"))),
          recordedTeam.map: (team, date) =>
            p(
              trb.lastRecordedTeam(),
              ": ",
              team,
              date.map(value => small(s" (${value.take(10)})"))
            ),
          player.year.map(year => p(trb.born(), ": ", year)),
          biography.map(text => p(cls := "pro-player-profile__biography")(text)),
          player.biographySources.zipWithIndex.map: (url, index) =>
            a(cls := "pro-player-profile__source", href := url, targetBlank)(
              trb.playerSource(),
              s" ${index + 1}"
            ),
          p(cls := "pro-player-profile__publication")(
            a(href := player.provenance.url, targetBlank)(player.provenance.provider.toUpperCase),
            s" · ${player.provenance.publishedAt}"
          ),
          player.ratingsMap.toList.map: (category, rating) =>
            val publication = player.ratingSources(category.key)
            p(
              strong(s"${category.key}: ${rating.value}"),
              " · ",
              a(href := publication.url, targetBlank)(
                s"${publication.provider.toUpperCase} · ${publication.publishedAt}"
              )
            )
        )
      ),
      Granter.opt(_.DirectoryPlayer).option(photoForm(player))
    )
  object thumbnail:
    def apply(image: Option[ImageId], size: DirectoryPlayer.PlayerPhoto.SizeSelector): Tag =
      image.fold(fallback): id =>
        img(src := url(id, size))
    def fallback = img(src := staticAssetUrl("images/anon-face.webp"))
    def url(photo: DirectoryPlayer.PlayerPhoto, size: DirectoryPlayer.PlayerPhoto.SizeSelector) =
      DirectoryPlayer.PlayerPhoto(picfitUrl, photo, size)
    def url(id: ImageId, size: DirectoryPlayer.PlayerPhoto.SizeSelector) =
      DirectoryPlayer.PlayerPhoto(picfitUrl, id, size)
  private def photoForm(player: DirectoryPlayer)(using ctx: Context) =
    val edit = lila.playerDirectory.DirectoryPlayer.form.edit(player, ctx.lang.code)
    form3.fieldset(trb.editProfile.txt(), toggle = player.photo.isEmpty.some)(
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
          form3.group(edit("photo.credit"), trans.ublog.imageCredit(), klass = "", half = true)(
            form3.input(_)
          )
        ),
        form3.group(
          edit("biography"),
          frag(trb.biography(), s" (${ctx.lang.code})"),
          klass = "",
          half = false,
          help = None
        )(
          form3.textarea(_)(rows := 5)
        ),
        form3.group(edit("sources"), trb.biographySources(), klass = "", half = false, help = None)(
          form3.textarea(_)(rows := 3)
        ),
        form3.action(form3.submit(trs.save()))
      )
    )
