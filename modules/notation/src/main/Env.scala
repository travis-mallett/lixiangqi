package lila.notation

import com.softwaremill.macwire.*
import play.api.Configuration

import lila.common.autoconfig.given
import lila.core.config.CollName

final class Env(
    appConfig: Configuration,
    db: lila.db.Db
)(using Executor):

  private lazy val scoreColl = db(appConfig.get[CollName]("notation.collection.score"))

  lazy val api = wire[NotationApi]

  lazy val forms = NotationForm

enum NotationMode:
  case moveFromNotation, writeNotation
object NotationMode:
  def find(name: String) = values.find(_.toString == name)

enum BoardPerspective:
  case red, black, both
object BoardPerspective:
  def find(name: String) = values.find(_.toString == name)
