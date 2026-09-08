package lila.web
package ui

import play.api.libs.json.Json

import lila.ui.*
import lila.xiangqi.SpecialRulesExamples

import ScalatagsTemplate.{ *, given }

final class LearnUi(helpers: Helpers):
  import helpers.*
  private val ancientManuals = List(
    ("zichudonglaiwudishou", "自出洞来无敌手", "The Invincible Xiangqi Manual", 35, 7),
    ("yicheng", "奕乘", "Yicheng", 134, 13),
    ("wushimeihuapu", "吴氏梅花谱", "Wu's Plum Flower Manual", 4, 1),
    ("wushuangpinmeihuapu", "无双品梅花谱", "Unparalleled Plum Flower Manual", 4, 1),
    ("shilinguangji", "事林广记", "Encyclopedia of Everything", 2, 1),
    ("shanqingtang", "善庆堂重订梅花变", "Shan Qing Tang Revised Plum Flower Variations", 17, 3),
    ("meihuaquan", "梅花泉", "Plum Flower Springs Manual", 50, 3),
    ("meihuapu", "梅花谱", "Plum Flower Manual", 31, 6),
    ("meihuabianfa", "梅花变法谱", "Plum Flower Variations Manual", 12, 1),
    ("juzhongmi", "桔中秘", "Secret in the Tangerine", 51, 4),
    ("jinpengshibabian", "金鹏十八变", "The 18 Stances of the Golden Roc", 51, 4),
    ("fanmeihuapu", "反梅花谱", "Anti-Plum Flower Manual", 8, 1),
    ("chongbentang", "崇本堂梅花谱", "Chong Ben Tang Plum Flower Manual", 20, 2)
  )

  def apply(data: Option[play.api.libs.json.JsValue])(using ctx: Context) =
    Page("Fundamentals of Xiangqi - learn by playing")
      .js:
        PageModule(
          "learn",
          Json.obj(
            "data" -> data,
            "pref" -> Json.obj(
              "coords" -> ctx.pref.coords,
              "destination" -> ctx.pref.destination
            )
          )
        )
      .css("learn")
      .i18n(_.learn)
      .graph(
        title = "Learn Xiangqi by playing",
        description =
          "Learn the board, pieces, rules, notation, tactics, and classical checkmating patterns of Xiangqi.",
        url = routeUrl(routes.Learn.index)
      )
      .hrefLangs(lila.ui.LangPath(routes.Learn.index))
      .flag(_.zoom):
        main(id := "learn-app")

  def specialRulesPage(using ctx: Context) =
    val chinese = ctx.lang.language == "zh"
    def text(en: String, zh: String) = if chinese then zh else en
    def renderExample(
        example: SpecialRulesExamples.Example,
        labelEn: String,
        labelZh: String,
        introEn: String,
        introZh: String
    ) =
      div(
        cls := "special-rules__example",
        attr("data-example-id") := example.id,
        tabindex := 0,
        attr("aria-label") := text(
          s"$labelEn example. Use the previous and next buttons to play the moves.",
          s"${labelZh}示例。使用前后按钮播放着法。"
        )
      )(
        div(cls := "special-rules__board main-board")(div(cls := "cg-wrap xiangqi9x10")),
        div(cls := "special-rules__playback")(
          div(cls := "special-rules__moves", attr("aria-label") := text("Example moves", "示例着法")),
          div(cls := "special-rules__feedback")(
            p(text(introEn, introZh)),
            div(cls := "special-rules__notice"),
            p(cls := "special-rules__status", role := "status")(text("Loading example…", "正在加载示例……"))
          ),
          div(cls := "special-rules__controls")
        )
      )
    Page(text("Special Rules", "特殊规则"))
      .css("learn")
      .js(
        PageModule(
          "xiangqi.specialRules",
          Json.obj(
            "examples" -> SpecialRulesExamples.all.map(example =>
              Json.obj(
                "id" -> example.id,
                "endpoint" -> routes.Learn.specialRulesExample(example.id, 0).url.dropRight(1)
              )
            ),
            "animationDuration" -> ctx.pref.animationMillis
          )
        )
      )
      .flag(_.zoom):
        main(cls := "page-menu special-rules article-page")(
          st.nav(
            cls := "page-menu__menu subnav",
            attr("aria-label") := text("Special Rules sections", "特殊规则章节")
          )(
            div(cls := "subnav__inner")(
              a(href := "#overview")(text("Overview", "概览")),
              a(href := "#repeated-checks")(text("Repeated checks", "长将")),
              a(href := "#repeated-chasing")(text("Repeated chasing", "长捉")),
              a(href := "#repeated-positions")(text("Repeated positions", "局面重复")),
              a(href := "#no-captures")(text("No captures", "自然限着")),
              a(href := "#other-draws")(text("Other automatic draws", "其他和棋"))
            )
          ),
          div(cls := "page-menu__content special-rules__main")(
            div(id := "overview", cls := "special-rules__panel special-rules__panel--overview box")(
              h1(text("Special Rules", "特殊规则")),
              p(cls := "special-rules__intro")(
                text(
                  "Special rules prevent a game from continuing indefinitely through repeated checks, repeated chasing, or repeated positions. They also provide move limits for games in which neither side makes progress. Depending on the rule being reached, the result may be a draw or the continuing move may be prohibited; the exact result is shown by the same rules system used in live games.",
                  "特殊规则用于防止棋局因反复长将、长捉或重复局面而无限进行，也为双方都没有实质进展的棋局设置限着。触及规则时，结果可能是判和，也可能是禁止继续的违规着法；具体结果由实战中使用的同一规则系统显示。"
                )
              ),
              p(
                text(
                  "Xiangqi is played under several related rulesets. The Chinese National Rules (中国象棋竞赛规则) are the detailed domestic competition rules, currently published in a 2020 edition. The Asian Xiangqi Federation rules (亚洲象棋联合会规则, often called “Asian rules”) were developed for international competition. The World Xiangqi Federation’s World Xiangqi Rules (世界象棋规则) are a later world ruleset based on the fourth revision of the Asian rules, with its own revisions; “Asian rules” and “WXF rules” are therefore related, but not simply two names for one identical document.",
                  "象棋存在几套彼此相关的规则体系。中国国家规则（《中国象棋竞赛规则》）是国内比赛使用的详细规则，目前为2020版。亚洲象棋联合会规则（常称“亚洲规则”）为国际比赛制定。世界象棋联合会的《世界象棋规则》是在亚洲规则第四次修订版基础上制定的后续世界规则，并作了自己的修订；因此，“亚洲规则”和“WXF规则”有关联，但并不是同一份文件的两个名称。"
                )
              ),
              p(
                text(
                  "Online platforms commonly use a fourth practical category: platform rules that simplify or adapt an official ruleset for online play. Lixiangqi’s default playable games use the Tiantian Xiangqi (天天象棋) ruleset. Under those rules, a single checking piece may give six consecutive checks, two checking pieces may give twelve, and three or more checking pieces may give eighteen. Other limits cover repeated quiet positions, repeated chasing, no-capture sequences, and total game length. A custom game set to Unrestricted does not apply these limits. Select a section on the left to see the exact rule and the live rules-engine example.",
                  "在线平台通常还会采用第四类实际规则：为适应网络对局而对官方规则进行简化或调整的平台规则。本站默认实战棋局采用天天象棋（Tiantian Xiangqi）规则。按该规则，使用一枚将军子最多连续将军六回合，使用两枚将军子最多十二回合，使用三枚或更多将军子最多十八回合；规则还限制重复闲着、重复追捉、无吃子着法以及棋局总步数。自定义棋局若选择“无限制”，则不采用这些限制。请选择左侧章节，查看具体规则和实战规则引擎示例。"
                )
              )
            ),
            st.section(id := "repeated-checks", cls := "special-rules__panel box")(
              h2(text("Repeated checks", "长将")),
              p(
                text(
                  "A side may continue checking only up to the limit for the checking pieces involved. The count is per checking side: six checks with one checking piece, twelve checks when two checking pieces are used, and eighteen checks when three or more checking pieces are used. The next prohibited check must be changed; it is not accepted as a legal continuation.",
                  "一方连续将军的次数取决于参与将军的棋子数量：使用一枚将军子最多六回合，使用两枚将军子最多十二回合，使用三枚或更多将军子最多十八回合。达到上限后，下一次违规将军必须变招，不能继续作为合法着法。"
                )
              ),
              h3(text("Repeated Checks with a Single Piece", "单子长将")),
              p(
                text(
                  "One checking piece may give up to six consecutive checks. Its seventh continuing check is prohibited. The example below shows this case: the six checks are accepted, and the seventh attempted check is displayed but rejected by the same rules engine used in live games.",
                  "使用同一枚棋子连续将军，最多允许六回合。第七次继续将军将被禁止。下面的示例展示了这一情况：前六次将军被接受，第七次尝试会显示在着法列表中，但会被实战使用的同一规则引擎拒绝。"
                )
              ),
              renderExample(
                SpecialRulesExamples.singlePiece,
                "Single-piece repeated check",
                "单子长将",
                "Follow Red’s chariot: six checks are accepted, then its seventh continuing check is rejected.",
                "观察红车：前六次将军被接受，第七次继续将军被拒绝。"
              ),
              h3(text("Check sequence restart and terminal priority", "将军序列重启与终局优先")),
              p(
                text(
                  "A quiet move breaks the consecutive checking sequence, so checking may begin again. The capture examples show that a capture resets the counters. A seventh check that checkmates is accepted because checkmate takes priority over the variation restriction; this is the behavior implemented here, without claiming parity with any unpublished platform rule.",
                  "闲着会打断连续将军序列，之后可以重新开始将军。吃子示例显示吃子会重置计数。若第七次将军同时将死，因将死优先于变招限制，该着仍被接受；这是本站当前实现的行为，并不宣称与未公开的平台规则完全一致。"
                )
              ),
              renderExample(
                SpecialRulesExamples.singleRestart,
                "Check sequence restart",
                "将军序列重启",
                "After six checks, Red makes a quiet move, then six fresh checks are allowed; the seventh check of the new sequence is rejected.",
                "六次将军后红方走闲着，新的序列随后允许六次将军；第七次新序列将军被拒绝。"
              ),
              renderExample(
                SpecialRulesExamples.singleMate,
                "Checkmate at the boundary",
                "终局将死边界",
                "Red’s cannon is the sole physical checker; the alternating horse only changes the screen. The ordinary seventh check is prohibited, but moving the other horse creates a distinct checkmate and is accepted. This records the current policy behavior; parity with Tencent’s private implementation is unverified.",
                "红炮是唯一实际将军子；交替移动的红马只改变炮架。普通的第七次将军会被拒绝，但移动另一匹马形成不同的将死局面，因此被接受。本示例记录本站当前策略行为，未核实与腾讯未公开实现的一致性。"
              ),
              renderExample(
                SpecialRulesExamples.checkerCapture,
                "Checking capture restart",
                "将军吃子重启",
                "The checking capture itself resets both forcing counters and the no-capture counter to zero; six later non-capturing checks are accepted before the next one is rejected.",
                "将军吃子本身会把双方强制计数和无吃子计数重置为零；之后六次不吃子的将军被接受，再下一次被拒绝。"
              ),
              renderExample(
                SpecialRulesExamples.defenderCapture,
                "Defender capture restart",
                "应将吃子重启",
                "After one earlier check, the checked side captures; that defender capture resets the counters before checking resumes.",
                "先有一次将军后，被将方吃子；这次应将吃子会在重新开始将军前重置计数。"
              ),
              h3(text("Repeated Checks with Two Pieces", "双子长将")),
              p(
                text(
                  "When two distinct physical checking pieces participate in the sequence, the allowance is twelve checks by that side. The thirteenth continuing check is prohibited.",
                  "当两枚不同的实体将军子参与这一序列时，该方最多允许十二回合将军。第十三次继续将军将被禁止。"
                )
              ),
              renderExample(
                SpecialRulesExamples.twoPieces,
                "Two-piece repeated check",
                "双子长将",
                "Both red horses participate. The first horse accounts for ten checks and the second for two; the attempted H5+3 is the latter horse's third check, proving the aggregate twelve-check boundary rather than a single-piece seventh-check limit.",
                "两匹红马都参与将军：第一匹马贡献十次，第二匹马贡献两次；最后尝试的 H5+3 是第二匹马的第三次将军，显示这是总计十二次的边界，而不是单子第七次将军限制。"
              ),
              h3(text("Repeated Checks with Three or More Pieces", "三子或更多棋子长将")),
              p(
                text(
                  "When three or more different checking pieces are involved, the allowance is eighteen checks by that side. The nineteenth continuing check is prohibited.",
                  "当三枚或更多不同的棋子参与将军时，该方最多允许十八回合将军。第十九次继续将军将被禁止。"
                )
              ),
              renderExample(
                SpecialRulesExamples.threePieces,
                "Three-piece repeated check",
                "三子长将",
                "Red’s chariot, horse, and cannon all give check. Watch for discovered cannon checks when another piece moves. Eighteen checks are accepted; the nineteenth is rejected.",
                "红车、红马和红炮都参与将军。注意其他棋子移动后形成的闪炮将军。前十八次将军被接受，第十九次被拒绝。"
              )
            ),
            st.section(id := "repeated-chasing", cls := "special-rules__panel box")(
              h2(text("Repeated chasing", "长捉")),
              p(
                text(
                  "A side may repeatedly threaten to capture the same opposing piece for up to six turns. This limit applies even when more than one of that side’s pieces is making the chase. The seventh continuing chase must be changed. A capture resets the forcing sequence.",
                  "一方连续追捉对方同一枚棋子，最多允许六回合；即使由多枚棋子参与追捉，也按同一目标计算。第七次继续追捉必须变招。吃子后，强制变招的连续计数重新开始。"
                )
              ),
              h3(text("Alternating Checks and Chases", "将捉交替")),
              p(
                text(
                  "If one side alternates checking and chasing, the sequence may continue for up to twelve turns when one piece is involved, or eighteen turns when multiple pieces are involved. The next continuing move in the prohibited sequence must be changed.",
                  "如果一方交替进行将军和追捉，只有一枚棋子参与时最多允许十二回合，多枚棋子参与时最多允许十八回合。达到上限后，继续该强制序列的下一着必须变招。"
                )
              ),
              renderExample(
                SpecialRulesExamples.alternatingSingle,
                "Single-piece alternating sequence",
                "单子将捉交替",
                "One physical piece alternates checking and chasing; the twelfth forcing move is accepted and the next continuation is rejected.",
                "同一枚棋子交替将军和追捉；第十二个强制着被接受，下一次继续被拒绝。"
              ),
              renderExample(
                SpecialRulesExamples.alternatingMultiple,
                "Multiple-piece alternating sequence",
                "多子将捉交替",
                "Two physical pieces alternate checking and chasing; the eighteen-move boundary is visible.",
                "两枚实体棋子交替将军和追捉；可以观察十八个强制着的边界。"
              ),
              renderExample(
                SpecialRulesExamples.alternatingRestart,
                "Alternating sequence restart",
                "将捉交替重启",
                "After twelve old alternating forcing moves, a quiet move resets the sequence. Twelve fresh moves then begin with a chase; the thirteenth new forcing move is rejected.",
                "十二个旧的将捉交替强制着后，闲着会重置序列。随后从追捉开始重新走十二个强制着；第十三个新强制着被拒绝。"
              ),
              h3(text("Restarting a chase", "追捉重启")),
              renderExample(
                SpecialRulesExamples.chase,
                "Repeated chase",
                "连续追捉",
                "The same target is chased six times; the seventh continuing chase is rejected.",
                "同一目标被追捉六次；第七次继续追捉被拒绝。"
              ),
              renderExample(
                SpecialRulesExamples.chaseRestart,
                "Chase sequence restart",
                "追捉序列重启",
                "A quiet move breaks the first chase sequence. The same target is then chased six fresh times, and the seventh chase is rejected.",
                "闲着会打断第一段追捉序列。随后同一目标被重新追捉六次，第七次追捉被拒绝。"
              )
            ),
            st.section(id := "repeated-positions", cls := "special-rules__panel box")(
              h2(text("Repeated positions", "局面重复")),
              p(
                text(
                  "A position is automatically drawn when the same side is to move and the same quiet position occurs five times. For this rule, the repeated sequence must contain no check, no chase, and no move responding to a check or chase. Checking and chasing are handled by their own limits instead.",
                  "轮到同一方走棋的同一闲着局面重复五次时，自动判和。用于计算的连续序列中不得有将军、追捉，也不得有应将或应捉的着法。将军和追捉分别按各自的上限处理。"
                )
              ),
              renderExample(
                SpecialRulesExamples.quietRepetition,
                "Quiet-position repetition",
                "闲着局面重复",
                "Five occurrences of the same quiet position produce an automatic draw; checks, chases, and responses are excluded from this sequence.",
                "同一闲着局面出现五次后自动判和；将军、追捉及其应对着不计入该序列。"
              )
            ),
            st.section(id := "no-captures", cls := "special-rules__panel box")(
              h2(text("No captures", "自然限着")),
              p(
                text(
                  "After 120 counted individual moves without a capture (60 moves by each side), the game is automatically drawn. Each side’s first ten non-capturing checks may count toward this limit; checks beyond that allowance do not advance the counter. A capture resets this count and the forcing-sequence counts. If the last move checkmates or stalemates, the game is not drawn by this limit.",
                  "连续120个计数半回合（双方各走60回合）未吃子时，自动判和。双方各自前十次不吃子的将军可以计入该限着数；超过十次的将军不再推进计数。吃子后，限着数和强制变招的连续计数都会重新开始。若最后一着将死或困毙，不按此限着判和。"
                )
              ),
              renderExample(
                SpecialRulesExamples.naturalLimit,
                "Natural move limit",
                "无吃子限着",
                "The full prior history is shown from counter zero. One hundred twenty counted quiet plies reach the draw; the coprime routes avoid an earlier fivefold repetition.",
                "从计数为零开始显示完整历史。累计一百二十个计数闲着半回合后判和；互质路线避免提前形成五次局面重复。"
              ),
              renderExample(
                SpecialRulesExamples.totalLimit,
                "Total move limit",
                "总着数限着",
                "The full history includes captures at the marked reset points. Captures reset the natural counter, but they do not reset the total played-ply counter; ply 400 is drawn by the move limit.",
                "完整历史包含标记的吃子重置点。吃子会重置无吃子计数，但不会重置总已走半回合数；第400个半回合因总着数限着判和。"
              )
            ),
            st.section(id := "other-draws", cls := "special-rules__panel box")(
              h2(text("Other automatic draws", "其他和棋")),
              p(
                text(
                  "The game is also drawn when neither side has an attacking piece (chariot, horse, cannon, or soldier), after 400 individual moves (200 moves by each side), when both sides have each maintained six checks, or when both sides have each chased the same opposing piece for six turns. Checkmate and stalemate take priority over the move-limit draws; in Xiangqi, stalemate is a win.",
                  "出现以下情况时也自动判和：双方都没有进攻子力（车、马、炮或兵）；总步数达到400个半回合（双方各走200回合）；双方各自连续将军六回合；或双方各自连续追捉同一枚对方棋子六回合。将死和困毙优先于限着和棋；在象棋中，困毙判胜。"
                )
              ),
              renderExample(
                SpecialRulesExamples.materialDraw,
                "Last attacker captured",
                "最后进攻子被吃",
                "Red starts in check and captures Black’s last attacking soldier. The resulting no-attacking-material draw is visible after one move.",
                "红方在被将军时开始，并吃掉黑方最后一枚进攻兵。一步之后即可看到无进攻子力和棋。"
              ),
              renderExample(
                SpecialRulesExamples.mutualChase,
                "Mutual chase boundary",
                "双方长捉边界",
                "Both sides chase the same physical opposing piece without checks or captures. The fifth chase by each side remains ongoing; the sixth each completes the mutual-chase draw.",
                "双方在没有将军或吃子的情况下，分别追捉同一枚对方实体棋子。双方各追捉五次后仍继续；双方各六次时判双方长捉和棋。"
              ),
              renderExample(
                SpecialRulesExamples.mutualCheck,
                "Mutual check boundary",
                "双方长将边界",
                "Each side gives six legal checks without captures. The fifth check by each side remains ongoing; the sixth each completes the mutual-check draw, below either side’s individual twelve-check limit.",
                "双方均在不吃子的情况下合法将军六次。双方各第五次将军后仍继续；双方各第六次将军时判双方长将和棋，低于任一方单独十二次的上限。"
              )
            )
          )
        )

  def ancientManualsPage(using ctx: Context) =
    val chinese = ctx.lang.language == "zh"
    val pageTitle = if chinese then "古谱" else "Ancient Manuals"
    Page(pageTitle)
      .js:
        PageModule(
          "xiangqi.manuals",
          Json.obj(
            "language" -> ctx.lang.code
          )
        )
      .css("learn")
      .graph(
        title = "Ancient Xiangqi Manuals",
        description = "Study classical Xiangqi manuals by chapter and annotated game.",
        url = routeUrl(routes.Learn.ancientManuals)
      )
      .flag(_.zoom):
        main(cls := "ancient-manuals box")(
          header(cls := "ancient-manuals__hero")(
            p(cls := "ancient-manuals__eyebrow")(
              if chinese then "中国象棋古典文库" else "The classical Xiangqi library"
            ),
            h1(pageTitle),
            p(cls := "ancient-manuals__introduction")(
              if chinese then "古谱保存了历代棋手学习象棋所依循的战略思想、经典阵法与评注对局。它们的分析早于现代引擎和当代开局理论，却仍是理解象棋战术语言、古典原则与历史传承的重要途径。"
              else
                "Ancient manuals preserve the strategic ideas, named patterns, and annotated examples through which generations learned Xiangqi. Their analysis predates modern engines and current opening theory, but studying them remains invaluable for understanding the game's tactical language, classical principles, and history."
            ),
            p(
              cls := "ancient-manuals__status",
              if chinese then "13 部古谱 · 419 局" else "13 manuals · 419 games"
            )
          ),
          st.section(
            cls := "ancient-manuals__library",
            attr("aria-labelledby") := "ancient-manuals-library-title"
          )(
            div(cls := "ancient-manuals__section-heading")(
              div(
                h2(id := "ancient-manuals-library-title")(
                  if chinese then "典籍目录" else "The collection"
                ),
                p(
                  if chinese then "选择一部古谱，浏览其章节与棋局。"
                  else "Choose a manual to explore its chapters and games."
                )
              )
            ),
            div(
              id := "ancient-manuals-list",
              cls := "ancient-manuals__grid",
              attr("aria-label") := (if chinese then "古谱目录" else "Ancient manuals")
            )(
              ancientManuals.map: (slug, nativeTitle, englishTitle, gameCount, chapterCount) =>
                button(
                  cls := "ancient-manual-card",
                  tpe := "button",
                  attr("data-manual-slug") := slug,
                  attr("aria-expanded") := "false",
                  attr("aria-controls") := "ancient-manual-detail"
                )(
                  span(cls := "ancient-manual-card__cover")(
                    img(
                      src := staticAssetUrl(s"images/learn/ancient-manuals/$slug.png"),
                      alt := "",
                      attr("aria-hidden") := "true"
                    )
                  ),
                  span(cls := "ancient-manual-card__copy")(
                    strong(cls := "ancient-manual-card__title")(
                      if chinese then nativeTitle else englishTitle
                    ),
                    span(cls := "ancient-manual-card__meta")(
                      if chinese then s"$gameCount 局 · $chapterCount 章"
                      else
                        s"$gameCount ${if gameCount == 1 then "game" else "games"} · $chapterCount ${
                            if chapterCount == 1 then "chapter" else "chapters"
                          }"
                    )
                  )
                )
            )
          ),
          st.section(
            id := "ancient-manual-detail",
            cls := "ancient-manual-detail",
            attr("aria-live") := "polite",
            attr("hidden") := true
          )
        )
  def xiangqiRankingsPage(levels: Vector[(String, Int)]) =
    val forumUrl =
      "https://chesshomeh5.qqchess.qq.com/#/sub_package/community/info/topic_detail/index?id=1671904&uHotType=1"
    val videoUrl = "https://www.youtube.com/watch?v=4CfsnZQAj8k"
    val previewImage = staticAssetUrl("images/learn/rankings/tiantian-rankings-preview.webp")
    val fullImage = staticAssetUrl("images/learn/rankings/tiantian-rankings-full.png")
    Page("About Xiangqi Rankings")
      .css("learn")
      .graph(
        title = "About Xiangqi Rankings",
        description = "How Xiangqi rank titles relate to rating points, practical skill, and Western Elo.",
        url = routeUrl(routes.Learn.xiangqiRankings)
      ):
        main(cls := "article-page xiangqi-rankings box box-pad")(
          header(id := "overview", cls := "xiangqi-rankings__header")(
            h1("About Xiangqi Rankings"),
            p(
              "Major Chinese-language Xiangqi apps, including Tiantian Xiangqi (天天象棋) and JJ Xiangqi, use broadly similar named ranks instead of presenting strength only as a Western-style rating. These apps account for a large share of online Xiangqi, although no audited cross-platform data supports a precise percentage and the details vary by app."
            ),
            p(
              "This page explains the difference between rating points and rank titles, how ratings change after ranked games, and how the full rank ladder is organized."
            )
          ),
          st.nav(cls := "xiangqi-rankings__nav", attr("aria-label") := "On this page")(
            a(cls := "active", href := "#overview")("Overview"),
            a(href := "#ratings")("Ratings"),
            a(href := "#rank-ladder")("Rank ladder"),
            a(href := "#rank-table")("Table")
          ),
          st.aside(cls := "xiangqi-rankings__summary")(
            span(cls := "xiangqi-rankings__summary-icon", attr("aria-hidden") := "true")("i"),
            div(
              h2("Quick summary"),
              ul(
                li("Rating is the number that changes after ranked games."),
                li("Rank is the title attached to a rating range."),
                li("Crossing a threshold changes the title.")
              )
            )
          ),
          st.section(id := "ratings")(
            h2("Rating points and rank titles"),
            dl(cls := "xiangqi-rankings__concepts")(
              div(
                dt("Rating"),
                dd("The number that changes after each ranked game.")
              ),
              div(
                dt("Rank"),
                dd("The title attached to a rating range. Crossing a threshold changes the title.")
              )
            ),
            h3("How ratings change"),
            p("Lixiangqi uses a simple zero-sum calculation for ranked games:"),
            ul(cls := "xiangqi-rankings__scoring")(
              li("Same rank: the winner gains 10 points and the loser loses 10."),
              li("Adjacent ranks, lower-ranked player wins: +15 / −15."),
              li("Adjacent ranks, higher-ranked player wins: +5 / −5."),
              li("Draw: no rating change.")
            ),
            p(
              "Ranked matchmaking permits players in the same or an adjacent rank. The rating floor is −250. Ratings can rise above 7000, but 专3-3 remains the highest title."
            ),
            h3(id := "rank-ladder")("The rank ladder"),
            p(
              "Tiantian Xiangqi divides its ranks into three broad groups, and Lixiangqi uses the same set of rank titles."
            ),
            ul(cls := "xiangqi-rankings__rank-groups")(
              li(
                span(cls := "xiangqi-rankings__rank-symbol", lang := "zh")("学"),
                span(strong("Student Rank"), small("学1-1 to 学3-3"))
              ),
              li(
                span(cls := "xiangqi-rankings__rank-symbol", lang := "zh")("业"),
                span(strong("Amateur Rank"), small("业1-1 to 业9-3"))
              ),
              li(
                span(cls := "xiangqi-rankings__rank-symbol", lang := "zh")("专"),
                span(strong("Professional Rank"), small("专1-1 to 专3-3"))
              )
            ),
            div(id := "rank-table", cls := "xiangqi-rankings__table-wrap")(
              table(cls := "xiangqi-rankings__table")(
                caption("Minimum rating for each Lixiangqi rank title"),
                thead(
                  tr(
                    th(attr("scope") := "col")("Rank"),
                    th(cls := "xiangqi-rankings__rating-column", attr("scope") := "col")("Rating")
                  )
                ),
                tbody(
                  levels.map: (rank, rating) =>
                    tr(
                      td(rank),
                      td(cls := "xiangqi-rankings__rating-column")(rating)
                    )
                )
              )
            )
          ),
          st.section(
            h2("What do the ranks mean?"),
            p(
              "There is no formal real-world definition for these app ranks. In a May 2025 post, the official Tiantian Xiangqi account asked players on the Chess Player’s Home (棋友之家) forum whether a circulated rank-to-skill comparison was accurate. That question—and the varied replies—make the status clear: these are community interpretations, not official titles or qualifications."
            ),
            p(
              "The ",
              a(href := forumUrl, target := "_blank", rel := "noopener")("original Tiantian post"),
              " and its replies discuss descriptions such as:"
            ),
            ul(cls := "xiangqi-rankings__meaning-list")(
              li(strong("业1"), " — “Entering the Scene”"),
              li(strong("业7"), " — “Can Sweep Casual Opponents”"),
              li(strong("业8-1 / 业8-2"), " — “Solid Tournament Competitor”"),
              li(strong("专1-2"), " — “Provincial Champion / Women’s Grandmaster”"),
              li(strong("专2-1"), " — “Elite Master / Grandmaster / National Champion”")
            ),
            p(cls := "xiangqi-rankings__note")(
              "Some respondents considered the comparison broadly accurate; others placed the same ranks noticeably higher or lower. Region, competition strength, time control, and online play all affect the comparison."
            ),
            figure(cls := "xiangqi-rankings__figure")(
              a(
                href := fullImage,
                target := "_blank",
                rel := "noopener",
                title := "View the full-resolution ranking infographic"
              )(
                img(
                  src := previewImage,
                  attr("width") := 1280,
                  attr("height") := 714,
                  attr("loading") := "lazy",
                  alt := "Infographic offering an unofficial comparison between Tiantian Xiangqi ranks and practical playing levels"
                )
              ),
              figcaption(
                "An unofficial practical comparison. Select the image to view the full-resolution version."
              )
            )
          ),
          st.section(
            h2("How do Xiangqi ranks compare with Western Elo?"),
            p(
              "No direct formal conversion is possible. Elo measures results within a particular player pool; app ranks use their own pools, thresholds, matchmaking, and scoring rules. A number from one system is therefore not mathematically interchangeable with a number from the other."
            ),
            p(
              "One rough approach is to translate a rank into a description such as “solid tournament competitor,” then ask which Western chess rating might fit the same description relative to the neighboring levels. The video ",
              a(href := videoUrl, target := "_blank", rel := "noopener")(
                "Tiantian Xiangqi Rankings Explained"
              ),
              " discusses that idea. It remains a theoretical, subjective, and unverifiable comparison—not a conversion table."
            )
          )
        )
