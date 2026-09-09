package lila.video

private[video] object VideoOrdering:
  def apply(
      videos: List[Video],
      sort: VideoSort,
      curatedIds: List[Video.ID] = Nil,
      views: Map[Video.ID, Int] = Map.empty
  ): List[Video] =
    sort match
      case VideoSort.Curated =>
        val positions = curatedIds.zipWithIndex.toMap
        videos.sortBy(v =>
          (positions.getOrElse(v.id, Int.MaxValue), v.sortOrder, -v.createdAt.toEpochMilli, v.id)
        )
      case VideoSort.Uploaded =>
        videos.sortBy(v =>
          (v.metadata.publishedAt.isEmpty, -v.metadata.publishedAt.fold(0L)(_.toEpochMilli), v.id)
        )
      case VideoSort.UploadedOldest =>
        videos.sortBy(v =>
          (v.metadata.publishedAt.isEmpty, v.metadata.publishedAt.fold(0L)(_.toEpochMilli), v.id)
        )
      case VideoSort.Views => videos.sortBy(v => (-views.getOrElse(v.id, 0), v.id))
      case VideoSort.Title => videos.sortBy(v => (v.title.toLowerCase(java.util.Locale.ROOT), v.id))
