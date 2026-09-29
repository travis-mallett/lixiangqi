package lila.pref

import play.api.libs.json.*

/** The board package owns the theme catalog; persisted preference keys stay stable. */
private[pref] object BoardCatalog:
  val json: JsValue =
    val stream = Option(getClass.getResourceAsStream("/board-catalog.json"))
      .getOrElse(throw IllegalStateException("Missing board asset catalog"))
    scala.util.Using.resource(stream)(Json.parse)

  val boards: List[BoardTheme] = (json \ "boards")
    .as[List[JsObject]]
    .map: entry =>
      BoardTheme(
        (entry \ "key").as[String],
        (entry \ "name").as[String],
        (entry \ "geometries" \ "xiangqi-9x10").as[String].stripPrefix("images/board/"),
        (entry \ "coordinateLight").as[String],
        (entry \ "coordinateDark").as[String],
        (entry \ "matchingPieceSet").asOpt[String]
      )

  val pieceEntries = (json \ "pieceSets").as[List[JsObject]]
  val pieces: List[PieceSet] = pieceEntries.map: entry =>
    val category = (entry \ "category").as[String]
    PieceSet(
      (entry \ "key").as[String],
      (entry \ "name").as[String],
      PieceSetCategory.values
        .find(_.key == category)
        .getOrElse(
          throw IllegalStateException(s"Unknown piece category $category")
        )
    )

  def pieceAssets(key: String, variant: String): List[(String, String)] =
    val entry = pieceEntries.find(entry => (entry \ "key").as[String] == key).get
    val assets = entry \ "variants" \ variant
    val faces = (assets \ "faces").as[Map[String, Map[String, String]]]
    val images = faces.toList.flatMap: (participant, roles) =>
      roles.toList.map { (role, path) => path -> s"---$participant-$role" }
    images :+ ((assets \ "back").as[String] -> "--board-piece-back")

  val shadows: List[(String, String)] = List(
    (json \ "shadows" \ "rest").as[String] -> "--xiangqi-rest-shadow-image",
    (json \ "shadows" \ "airborne").as[String] -> "--xiangqi-airborne-shadow-image"
  )
