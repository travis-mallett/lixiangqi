package lila.web
package ui

import lila.ui.*

import ScalatagsTemplate.{ *, given }

val fideHandbookUrl =
  "https://www.wxf-xiangqi.org/index.php?Itemid=291&id=269&lang=en&option=com_content&view=article"

final class FaqUi(helpers: Helpers, sitePages: SitePages)(
    standardRankableDeviation: Int,
    variantRankableDeviation: Int
):
  import helpers.{ given, * }
  import trans.faq as trf

  private def cmsPageUrl(key: String) = routes.Cms.lonePage(lila.core.id.CmsPageKey(key))

  private def question(id: String, title: String, answer: Frag*) =
    details(
      st.id := id,
      cls := "question",
      name := "faq"
    )(
      summary(span(title)),
      div(cls := "answer")(answer)
    )

  def apply(using Context) =
    sitePages
      .SitePage(
        title = "Frequently Asked Questions",
        active = "faq"
      )
      .css("bits.faq"):
        div(cls := "faq box box-pad")(
          h1(cls := "box__top")(trf.frequentlyAskedQuestions()),
          h2("Lixiangqi"),
          question(
            "name",
            trf.whyIsLichessCalledLichess.txt(),
            p(
              trf.lichessCombinationLiveLightLibrePronounced(em(trf.leechess())),
              " ",
              a(href := "https://www.youtube.com/watch?v=KRpPqcrdE-o")(trf.hearItPronouncedBySpecialist())
            ),
            p(
              trf.whyLiveLightLibre()
            ),
            p(
              trf.whyIsLilaCalledLila(
                a(href := "https://github.com/lichess-org/lila")("lila"),
                a(href := "https://scala-lang.org/")("Scala")
              )
            )
          ),
          question(
            "contributing",
            trf.howCanIContributeToLichess.txt(),
            p(trf.lichessPoweredByDonationsAndVolunteers()),
            p(
              trf.findMoreAndSeeHowHelp(
                a(href := routes.Plan.index())(trf.beingAPatron()),
                a(href := routes.Main.costs)(trf.breakdownOfOurCosts()),
                a(href := routes.Cms.help)(trf.otherWaysToHelp())
              )
            )
          ),
          question(
            "sites_based_on_Lichess",
            trf.areThereWebsitesBasedOnLichess.txt(),
            p(
              trf.yesLichessInspiredOtherOpenSourceWebsites(
                a(href := "/source")(trans.site.sourceCode()),
                a(href := "/api")("API"),
                a(href := routes.GameCatalog.index)(trans.site.database())
              )
            ),
            ul(
              li(a(href := "https://blitztactics.com/about")("Blitz Tactics")),
              li(a(href := "https://tailuge.github.io/chess-o-tron/html/blunder-bomb.html")("Blunder Bomb")),
              li(a(href := "https://lidraughts.org")("lidraughts.org")),
              li(a(href := "https://playstrategy.org")("playstrategy.org")),
              li(a(href := "https://lishogi.org")("lishogi.org"))
            )
          ),
          question(
            "keyboard-shortcuts",
            trf.keyboardShortcuts.txt(),
            p(
              trf.keyboardShortcutsExplanation()
            )
          ),
          h2(trf.fairPlay()),
          question(
            "rating-refund",
            trf.whenAmIEligibleRatinRefund.txt(),
            p(
              trf.ratingRefundExplanation()
            )
          ),
          question(
            "leaving",
            trf.preventLeavingGameWithoutResigning.txt(),
            p(
              trf.leavingGameWithoutResigningExplanation()
            )
          ),
          question(
            "mod-application",
            trf.howCanIBecomeModerator.txt(),
            p(
              trf.youCannotApply()
            )
          ),
          question(
            "correspondence",
            trf.isCorrespondenceDifferent.txt(),
            p(
              trf.youCanUseOpeningBookNoEngine()
            ),
            p(
              trf.pleaseReadFairPlayPage(a(href := cmsPageUrl("fair-play"))(trf.fairPlayPage()))
            )
          ),
          h2(trf.gameplay()),
          question(
            "time-controls",
            trf.howBulletBlitzEtcDecided.txt(),
            p(
              trf.basedOnGameDuration(strong(trf.durationFormula()))
            ),
            ul(
              li(trf.inferiorThanXsEqualYtimeControl(29, "UltraBullet")),
              li(trf.inferiorThanXsEqualYtimeControl(179, trans.site.bullet())),
              li(trf.inferiorThanXsEqualYtimeControl(479, trans.site.blitz())),
              li(trf.inferiorThanXsEqualYtimeControl(1499, trans.site.rapid())),
              li(trf.superiorThanXsEqualYtimeControl(1500, trans.site.classical()))
            )
          ),
          question(
            "acpl",
            trf.whatIsACPL.txt(),
            p(
              trf.acplExplanation()
            )
          ),
          question(
            "timeout",
            trf.insufficientMaterial.txt(),
            p(
              trf.lichessFollowFIDErules(a(href := fideHandbookUrl)(trf.fideHandbook()))
            )
          ),
          question(
            "en-passant",
            trf.discoveringEnPassant.txt(),
            p(
              trf.explainingEnPassant(
                a(href := "https://en.wikipedia.org/wiki/Xiangqi#Rules")(trf.goodIntroduction()),
                a(href := fideHandbookUrl)(trf.fideHandbook()),
                a(href := s"${routes.Learn.index}#/15")(trf.lichessTraining())
              )
            ),
            p(
              trf.watchIMRosenCheckmate(
                a(href := "https://en.wikipedia.org/wiki/Xiangqi#Rules")("generals")
              )
            )
          ),
          question(
            "threefold",
            trf.threefoldRepetition.txt(),
            p(
              trf.threefoldRepetitionExplanation(
                a(href := "https://en.wikipedia.org/wiki/Threefold_repetition")(
                  trf.threefoldRepetitionLowerCase()
                ),
                a(href := fideHandbookUrl)(trf.fideHandbook())
              )
            ),
            h4(trf.notRepeatedMoves()),
            p(
              trf.repeatedPositionsThatMatters(
                em(trf.positions())
              )
            ),
            h4(trf.weRepeatedthreeTimesPosButNoDraw()),
            p(
              trf.threeFoldHasToBeClaimed(
                a(href := routes.Pref.form("game-behavior"))(trf.configure())
              )
            )
          ),
          h2(trf.accounts()),
          question(
            "titles",
            trf.titlesAvailableOnLichess.txt(),
            p(
              trf.lichessRecognizeAllOTBtitles(
                a(href := routes.TitleVerify.index)(
                  trf.asWellAsManyNMtitles()
                )
              )
            ),
            ul(
              li("Grandmaster"),
              li("International Master"),
              li("Xiangqi Master"),
              li("National Master"),
              li("Woman Grandmaster"),
              li("Woman International Master"),
              li("Woman Xiangqi Master"),
              li("Woman National Master")
            ),
            p(
              trf.showYourTitle(
                a(href := routes.TitleVerify.index)(trf.verificationForm()),
                a(href := "#lm")("Lixiangqi Master (LM)")
              )
            )
          ),
          question(
            "lm",
            trf.canIbecomeLM.txt(),
            p(strong(trf.noUpperCaseDot())),
            p(trf.lMtitleComesToYouDoNotRequestIt())
          ),
          question(
            "usernames",
            trf.whatUsernameCanIchoose.txt(),
            p(
              trf.usernamesNotOffensive(
                a(href := cmsPageUrl("username-policy"))(trf.guidelines())
              )
            )
          ),
          question(
            "change-username",
            trf.canIChangeMyUsername.txt(),
            p(trf.usernamesCannotBeChanged.txt())
          ),
          question(
            "trophies",
            trf.uniqueTrophies.txt(),
            h4("The Golden Zee"),
            p(
              trf.ownerUniqueTrophies(
                a(href := "/@/ZugAddict")("ZugAddict")
              )
            ),
            p(
              trf.goldenZeeExplanation()
            )
          ),
          h2(trf.lichessRatings()),
          question(
            "ratings",
            trf.whichRatingSystemUsedByLichess.txt(),
            p(
              trf.ratingSystemUsedByLichess()
            ),
            p(
              a(href := cmsPageUrl("rating-systems"))("More about rating systems")
            )
          ),
          question(
            "provisional",
            trf.whatIsProvisionalRating.txt(),
            p(trf.provisionalRatingExplanation()),
            ul(
              li(
                trf.notPlayedEnoughRatedGamesAgainstX(
                  em(trf.similarOpponents())
                )
              ),
              li(
                trf.notPlayedRecently()
              )
            ),
            p(
              trf.ratingDeviationMorethanOneHundredTen()
            )
          ),
          question(
            "leaderboards",
            trf.howDoLeaderoardsWork.txt(),
            p(
              trf.inOrderToAppearsYouMust(
                a(href := routes.User.list)(trf.ratingLeaderboards())
              )
            ),
            ol(
              li(trf.havePlayedMoreThanThirtyGamesInThatRating()),
              li(trf.havePlayedARatedGameAtLeastOneWeekAgo()),
              li(
                trf.ratingDeviationLowerThanXinChessYinVariants(
                  standardRankableDeviation,
                  variantRankableDeviation
                )
              ),
              li(trf.beInTopTen())
            ),
            p(
              trf.secondRequirementToStopOldPlayersTrustingLeaderboards()
            )
          ),
          question(
            "high-ratings",
            trf.whyAreRatingHigher.txt(),
            p(
              trf.whyAreRatingHigherExplanation()
            ),
            p(
              a(href := cmsPageUrl("rating-systems"))("More about rating systems")
            )
          ),
          question(
            "hide-ratings",
            trf.howToHideRatingWhilePlaying.txt(),
            p(
              trf.enableZenMode(
                a(href := routes.Pref.form("game-display"))(trf.displayPreferences()),
                em("z")
              )
            )
          ),
          question(
            "disconnection-loss",
            trf.connexionLostCanIGetMyRatingBack.txt(),
            p(
              trf.weCannotDoThatEvenIfItIsServerSideButThatsRare()
            )
          ),
          h2(trf.howToThreeDots()),
          question(
            "browser-notifications",
            trf.enableDisableNotificationPopUps.txt(),
            p(
              img(
                src := assetUrl("images/connection-info.png"),
                alt := trf.viewSiteInformationPopUp.txt()
              )
            ),
            p(
              trf.lichessCanOptionnalySendPopUps()
            )
          ),
          question(
            "autoplay",
            trf.enableAutoplayForSoundsQ.txt(),
            p(trf.enableAutoplayForSoundsA()),
            h3("Mozilla Firefox (", trf.desktop(), ")"),
            p(trf.enableAutoplayForSoundsFirefox()),
            h3("Google Chrome (", trf.desktop(), ")"),
            p(trf.enableAutoplayForSoundsChrome()),
            h3("Safari (", trf.desktop(), ")"),
            p(trf.enableAutoplayForSoundsSafari()),
            h3("Microsoft Edge (", trf.desktop(), ")"),
            p(trf.enableAutoplayForSoundsMicrosoftEdge())
          ),
          question(
            "make-a-bot",
            "Make a Lixiangqi bot?",
            p("Bot play is not part of the initial Lixiangqi release.")
          ),
          question(
            "stop-chess-addiction",
            trf.stopMyselfFromPlaying.txt(),
            p(
              trf.adviceOnMitigatingAddiction(
                a(href := "https://getcoldturkey.com")("ColdTurkey"),
                a(href := "https://freedom.to")("Freedom"),
                a(href := "https://www.proginosko.com/leechblock")("LeechBlock"),
                a(href := cmsPageUrl("userstyles"))(trf.lichessUserstyles()),
                a(href := cmsPageUrl("userstyles"))(
                  trf.fewerLobbyPools()
                ),
                a(href := "https://icd.who.int/browse/2024-01/mms/en#1448597234")(trf.mentalHealthCondition())
              )
            )
          )
        )
