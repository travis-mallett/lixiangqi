package lila.core
package fishnet

import _root_.chess.format.{ Fen, Uci }
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import scalalib.ThreadLocalRandom

import lila.core.id.{ GameId, StudyChapterId, StudyId }
import lila.core.userId.UserId

val maxPlies = 600

case class NewKey(userId: UserId, key: String)

enum Bus:
  case GameRequest(gameId: GameId)
  case StudyChapterRequest(
      studyId: StudyId,
      chapterId: StudyChapterId,
      initialFen: Option[Fen.Full],
      variant: _root_.chess.variant.Variant,
      moves: List[Uci],
      userId: UserId,
      official: Boolean
  )
  case StudyChapterDelete(chapterIds: Seq[StudyChapterId]) // clear analysis of chapter
  case StudyChapterOrphan(chapterIds: Seq[StudyChapterId]) // chapter has been deleted

type AnalysisAwaiter = (Seq[GameId], FiniteDuration) => Fu[Int]

trait FishnetRequest:
  def tutor(gameId: GameId): Funit

opaque type AiTurnKey = String
object AiTurnKey extends OpaqueString[AiTurnKey]:

  def from(game: lila.core.game.Game): Option[AiTurnKey] =
    game.aiLevel.map(level => apply(game, effectiveLevel(game, level)))

  def effectiveLevel(game: lila.core.game.Game, level: Int): Int =
    if level < 3 && game.clock.exists(_.config.limitSeconds < 60) then 3 else level

  /** Identifies all inputs that define one AI turn.
    *
    * Keep this canonical representation in sync with the move worker. The full history is intentional:
    * Xiangqi repetition rules cannot be represented by the current board FEN alone.
    */
  def apply(game: lila.core.game.Game, level: Int): AiTurnKey =
    val canonical = List(
      "lixiangqi-ai-turn-v2",
      game.id.value,
      level.toString,
      game.xiangqi.initialFen,
      game.xiangqi.moves.map(_.value).mkString(" "),
      game.xiangqi.ruleset.key
    ).mkString("\u0000")
    val bytes = MessageDigest
      .getInstance("SHA-256")
      .digest(canonical.getBytes(StandardCharsets.UTF_8))
    AiTurnKey(bytes.map(byte => f"${byte & 0xff}%02x").mkString)

opaque type AiMoveRequestId = String
object AiMoveRequestId extends OpaqueString[AiMoveRequestId]:
  /** Idempotency identity for one observed AI-turn occurrence. Delivery retries reuse it. */
  def random(): AiMoveRequestId = AiMoveRequestId(ThreadLocalRandom.nextString(12))

case class FishnetMoveRequest(
    game: lila.core.game.Game,
    turnKey: AiTurnKey,
    requestId: AiMoveRequestId
)
