package lila.study

import lila.core.study.StudyOrder
import lila.db.dsl.{ *, given }

/** Permissions are queried on the study document itself. Only chapter metadata is projected. */
object StudySearch:
  case class Query(terms: List[String], owner: Option[String], member: Option[String]):
    def text = terms
      .map: term =>
        if term.startsWith("-") then s"-\"${term.drop(1)}\"" else s"\"$term\""
      .mkString(" ")

    def selector(viewer: Option[UserId]): Bdoc =
      val access = viewer.fold($doc("visibility" -> "public")): id =>
        $or($doc("visibility" -> "public"), $doc("uids" -> id))
      access ++ owner.so(value => $doc("ownerId" -> value)) ++
        member.so(value => $doc("uids" -> value)) ++ terms.nonEmpty.so($text(text, "none"))

    def sort(order: StudyOrder): Bdoc =
      val ranking = if terms.nonEmpty then $doc("score" -> $doc("$meta" -> "textScore")) else $empty
      val field = order match
        case StudyOrder.alphabetical => $sort.asc("name")
        case StudyOrder.hot => $sort.desc("rank")
        case StudyOrder.newest => $sort.desc("createdAt")
        case StudyOrder.oldest => $sort.asc("createdAt")
        case StudyOrder.popular => $sort.desc("likes")
        case StudyOrder.updated => $sort.desc("updatedAt")
        case StudyOrder.mine => $sort.asc("likes")
        case StudyOrder.relevant => $empty
      field ++ ranking ++ $sort.asc("_id")

  def parse(input: String): Query =
    val tokens = "\"([^\"]*)\"|(\\S+)".r
      .findAllMatchIn(input.take(100))
      .map: matched =>
        Option(matched.group(1)).getOrElse(matched.group(2))
      .toList
    def filter(name: String) = tokens.find(_.startsWith(s"$name:")).map(_.drop(name.length + 1).toLowerCase)
    Query(
      tokens.filterNot(t => t.startsWith("owner:") || t.startsWith("member:")),
      filter("owner"),
      filter("member")
    )
