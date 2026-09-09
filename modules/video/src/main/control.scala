package lila.video

import lila.common.ClientName

case class TagNb(_id: Tag, nb: Int):

  def tag = _id

  def empty = nb == 0

  def isNumeric = tag.forall(_.isDigit)

case class Filter(tags: List[String]):

  def toggle(tag: String) =
    copy(
      tags = if tags contains tag then tags.filter(tag !=) else tags :+ tag
    )

case class UserControl(
    filter: Filter,
    tags: List[TagNb],
    query: Option[String],
    sort: VideoSort = VideoSort.Curated,
    allVideos: Boolean = false
)(using client: ClientName):

  def forTag(name: Tag) =
    copy(filter = Filter(List(name)), query = none, sort = VideoSort.Curated, allVideos = false)

  def toggleTag(tag: String) =
    copy(
      filter = filter.toggle(tag),
      query = none,
      allVideos = false
    )

  private def encode(value: String) =
    java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8)

  def queryString =
    (filter.tags.sorted.map(tag => s"tag=${encode(tag)}") ::: List(
      query.map(q => s"q=${encode(q)}"),
      (sort != VideoSort.Curated).option(s"sort=${sort.key}"),
      allVideos.option("all=1")
    ).flatten).mkString("&")

  def queryStringUnlessBot = client.isHuman.so(queryString)
