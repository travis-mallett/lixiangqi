package lila.fishnet

import lila.xiangqi.adjudication.Ruleset
import reactivemongo.api.bson.*

import lila.db.dsl.{ *, given }

private object BSONHandlers:

  given BSONHandler[Client.Skill] = tryHandler(
    { case BSONString(v) => Client.Skill.byKey(v).toTry(s"Invalid client skill $v") },
    x => BSONString(x.key)
  )

  given BSONDocumentHandler[Client.Instance] = Macros.handler

  given BSONDocumentHandler[Client] = Macros.handler

  given BSONHandler[Ruleset] = tryHandler[Ruleset](
    { case BSONString(v) => Ruleset.fromKey(v).left.map(error => new IllegalArgumentException(error)).toTry },
    x => BSONString(x.key)
  )

  private given BSONDocumentHandler[Work.Acquired] = Macros.handler
  given BSONDocumentHandler[Work.Game] = Macros.handler
  private given BSONDocumentHandler[Work.Sender] = Macros.handler
  given BSONHandler[Work.Origin] =
    valueMapHandler(Work.Origin.values.map(o => o.toString -> o).toMap)(_.toString)
  given BSONDocumentHandler[Work.Analysis] = Macros.handler
