package lila.video

import reactivemongo.api.bson.*
import scalalib.paginator.*

import lila.db.dsl.{ *, given }
import lila.db.paginator.Adapter
import lila.memo.CacheApi.*

final private[video] class VideoApi(
    videoColl: Coll,
    viewColl: Coll,
    tagColl: Coll,
    cacheApi: lila.memo.CacheApi
)(using Executor):

  import BsonHandlers.given
  private given BSONDocumentHandler[TagNb] = Macros.handler
  private given BSONDocumentHandler[VideoTag] = Macros.handler
  import View.given

  private val publishedSelector = $or(
    $doc("status" -> VideoStatus.Published.key),
    $doc("status".$exists(false))
  )

  private def statusSelector(status: VideoStatus): Bdoc =
    if status == VideoStatus.Published then publishedSelector
    else $doc("status" -> status.key)

  private val publicSort = $doc("sortOrder" -> 1, "createdAt" -> -1, "_id" -> 1)

  private val catalogueCache = cacheApi.unit[List[Video]]("video.catalogue"):
    _.refreshAfterWrite(10.minutes).buildAsyncFuture: _ =>
      videoColl.find(publishedSelector).sort(publicSort).cursor[Video]().list(Int.MaxValue)

  private val tagSettingsCache = cacheApi.unit[List[VideoTag]]("video.tags"):
    _.refreshAfterWrite(10.minutes).buildAsyncFuture: _ =>
      tagColl.find($empty).cursor[VideoTag]().list(Int.MaxValue)

  private val viewCountsCache = cacheApi.unit[Map[String, Int]]("video.viewCounts"):
    _.refreshAfterWrite(10.minutes).buildAsyncFuture: _ =>
      viewColl
        .aggregateList(Int.MaxValue, _.sec): framework =>
          import framework.*
          GroupField(View.BSONFields.videoId)("nb" -> SumAll) -> Nil
        .map(_.flatMap(_.asOpt[TagNb]).map(v => v._id -> v.nb).toMap)

  private def orderedTags(videos: List[Video], settings: List[VideoTag]): List[VideoTag] =
    val saved = settings.map(t => t.name -> t).toMap
    videos
      .flatMap(_.tags)
      .distinct
      .map(t => saved.getOrElse(t, VideoTag.defaultTag(t)))
      .sortBy(t => (t.sortOrder, VideoTag.naturalOrder(t.name)))

  private val pathsCache = cacheApi[List[Tag], List[TagNb]](32, "video.paths"):
    _.expireAfterAccess(10.minutes).buildAsyncFuture(computeTagPaths)

  private val popularTagsCache = cacheApi.unit[List[TagNb]]("video.popular"):
    _.refreshAfterWrite(1.day).buildAsyncFuture: _ =>
      videoColl
        .aggregateList(maxDocs = Int.MaxValue, _.sec): framework =>
          import framework.*
          Match(publishedSelector) -> List(
            Project($doc("tags" -> true)),
            UnwindField("tags"),
            GroupField("tags")("nb" -> SumAll),
            Sort(Descending("nb"))
          )
        .map(_.flatMap(_.asOpt[TagNb]))

  private def invalidateListings(): Unit =
    pathsCache.invalidateAll()
    popularTagsCache.invalidateUnit()
    catalogueCache.invalidateUnit()

  private def videoViews(userOption: Option[UserId])(videos: Seq[Video]): Fu[Seq[VideoView]] =
    userOption match
      case None => fuccess(videos.map(VideoView(_, view = false)))
      case Some(user) =>
        view
          .seenVideoIds(user, videos)
          .map: ids =>
            videos.map(v => VideoView(v, ids.contains(v.id)))

  object video:

    def home(user: Option[UserId]): Fu[List[VideoSection]] =
      for
        videos <- catalogueCache.getUnit
        settings <- tagSettingsCache.getUnit
        grouped = videos.flatMap(v => v.tags.distinct.map(_ -> v)).groupMap(_._1)(_._2)
        sections = orderedTags(videos, settings).map: t =>
          val matching = VideoOrdering(grouped.getOrElse(t.name, Nil), VideoSort.Curated, t.videoIds)
          (t, matching.take(18), matching.size)
        previews <- videoViews(user)(sections.flatMap(_._2))
      yield
        val byId = previews.map(v => v.video.id -> v).toMap
        sections.map((t, vs, count) => VideoSection(t, vs.map(v => byId(v.id)), count))

    def byTag(user: Option[UserId], name: Tag, sort: VideoSort, page: Int): Fu[Paginator[VideoView]] =
      categoryPager(user, List(name), sort, page)

    private def categoryPager(
        user: Option[UserId],
        tags: List[Tag],
        sort: VideoSort,
        page: Int
    ): Fu[Paginator[VideoView]] =
      for
        videos <- catalogueCache.getUnit
        settings <- tagSettingsCache.getUnit
        counts <- if sort == VideoSort.Views then viewCountsCache.getUnit else fuccess(Map.empty[String, Int])
        curatedIds = tags match
          case name :: Nil => settings.find(_.name == name).fold(List.empty[Video.ID])(_.videoIds)
          case _ => Nil
        matching = videos.filter(v => tags.forall(v.tags.contains))
        sorted = VideoOrdering(matching, sort, curatedIds, counts)
        pager <- Paginator(
          adapter = new lila.db.paginator.StaticAdapter(sorted).mapFutureList(videoViews(user)),
          currentPage = page,
          maxPerPage = maxPerPage
        )
      yield pager

    private val maxPerPage = MaxPerPage(18)
    private val maxAdminPerPage = MaxPerPage(40)

    def find(id: Video.ID): Fu[Option[Video]] = videoColl.byId[Video](id)

    def findVisible(id: Video.ID, canManage: Boolean): Fu[Option[Video]] =
      find(id).map(_.filter(video => canManage || video.isPublished))

    def search(user: Option[UserId], query: String, page: Int): Fu[Paginator[VideoView]] =
      val q = quotedQuery(query)
      Paginator(
        adapter = new Adapter[Video](
          collection = videoColl,
          selector = publishedSelector ++ $text(q),
          projection = $doc("score" -> $doc("$meta" -> "textScore")).some,
          sort = $doc("score" -> $doc("$meta" -> "textScore")),
          _.sec
        ).mapFutureList(videoViews(user)),
        currentPage = page,
        maxPerPage = maxPerPage
      )

    def byTags(
        user: Option[UserId],
        tags: List[Tag],
        page: Int,
        sort: VideoSort = VideoSort.Curated
    ): Fu[Paginator[VideoView]] =
      categoryPager(user, tags, sort, page)

    def byAuthor(user: Option[UserId], author: String, page: Int): Fu[Paginator[VideoView]] =
      publicPager(user, publishedSelector ++ $doc("author" -> author), page)

    private def publicPager(user: Option[UserId], selector: Bdoc, page: Int) =
      Paginator(
        adapter = new Adapter[Video](
          collection = videoColl,
          selector = selector,
          projection = none,
          sort = publicSort,
          _.sec
        ).mapFutureList(videoViews(user)),
        currentPage = page,
        maxPerPage = maxPerPage
      )

    def similar(user: Option[UserId], video: Video, max: Int): Fu[Seq[VideoView]] =
      videoColl
        .aggregateList(maxDocs = max, _.sec): framework =>
          import framework.*
          Match(
            publishedSelector ++ $doc(
              "tags".$in(video.tags),
              "_id".$ne(video.id)
            )
          ) -> List(
            AddFields:
              $doc("similarity" -> $doc("$size" -> $doc("$setIntersection" -> $arr("$tags", video.tags))))
            ,
            Sort(Descending("similarity"), Ascending("sortOrder")),
            Limit(max)
          )
        .map(_.flatMap(_.asOpt[Video]))
        .flatMap(videoViews(user))

    def admin(
        status: Option[VideoStatus],
        needsAttention: Boolean,
        query: Option[String],
        page: Int
    ): Fu[Paginator[Video]] =
      val statusQuery =
        if needsAttention then $or($doc("metadata.error".$exists(true)), $doc("metadata.available" -> false))
        else status.fold($empty)(statusSelector)
      val selector = query
        .map(_.trim)
        .filter(_.nonEmpty)
        .fold(statusQuery): q =>
          statusQuery ++ $text(quotedQuery(q))
      Paginator(
        adapter = Adapter[Video](
          collection = videoColl,
          selector = selector,
          projection = none,
          sort = publicSort
        ),
        currentPage = page,
        maxPerPage = maxAdminPerPage
      )

    def publishedForReorder: Fu[List[Video]] =
      videoColl.find(publishedSelector).sort(publicSort).cursor[Video]().list(Int.MaxValue)

    def stale(limit: Int): Fu[List[Video]] =
      videoColl
        .find(publishedSelector)
        .sort($sort.asc("metadata.refreshedAt"))
        .cursor[Video]()
        .list(limit)

    def sourceExists(source: VideoSource, except: Option[Video.ID] = None): Fu[Boolean] =
      val currentSource = $doc(
        "source.provider" -> source.provider.key,
        "source.externalId" -> source.externalId
      )
      val selector =
        if source.provider == VideoProvider.Youtube then
          $or(
            currentSource,
            // Before the one-time migration, legacy YouTube documents use their provider ID as `_id`.
            $doc("_id" -> source.externalId, "source".$exists(false))
          )
        else currentSource
      videoColl.exists(selector ++ except.so(id => $doc("_id".$ne(id))))

    def nextSortOrder: Fu[Int] = videoColl.countAll.map(count => Math.multiplyExact(count.toInt, 10))

    def insert(video: Video): Funit =
      videoColl.insert
        .one(video)
        .void
        .map: _ =>
          invalidateListings()

    def update(video: Video): Funit =
      videoColl.update
        .one($id(video.id), video)
        .void
        .map: _ =>
          invalidateListings()

    def setStatus(video: Video, status: VideoStatus)(using me: MyId): Funit =
      videoColl.update
        .one(
          $id(video.id),
          $set("status" -> status.key, "updatedAt" -> nowInstant, "updatedBy" -> me.userId)
        )
        .void
        .map: _ =>
          invalidateListings()

    def setMetadata(video: Video, metadata: VideoMetadata): Funit =
      videoColl.update
        .one(
          $id(video.id),
          $set("metadata" -> BsonHandlers.metadataDocument(metadata), "updatedAt" -> nowInstant)
        )
        .void
        .map(_ => catalogueCache.invalidateUnit())

    def reorder(ids: List[Video.ID])(using me: MyId): Funit =
      val update = videoColl.update(ordered = true)
      for
        elements <- ids.zipWithIndex.sequentially: (id, index) =>
          update.element(
            q = $id(id) ++ publishedSelector,
            u = $set("sortOrder" -> index * 10, "updatedAt" -> nowInstant, "updatedBy" -> me.userId)
          )
        _ <- elements.nonEmpty.so(update.many(elements).void)
        _ = invalidateListings()
      yield ()

  object view:

    def find(videoId: Video.ID, userId: UserId): Fu[Option[View]] =
      viewColl.find($doc(View.BSONFields.id -> View.makeId(videoId, userId))).one[View]

    def add(a: View) = viewColl.insert.one(a).void.recover(lila.db.recoverDuplicateKey(_ => ()))

    def hasSeen(user: UserId, video: Video): Fu[Boolean] =
      viewColl.countSel($doc(View.BSONFields.id -> View.makeId(video.id, user))).map(0 !=)

    def seenVideoIds(user: UserId, videos: Seq[Video]): Fu[Set[Video.ID]] =
      viewColl.distinctEasy[String, Set](
        View.BSONFields.videoId,
        $inIds(videos.map(v => View.makeId(v.id, user))),
        _.sec
      )

  object tag:

    def all: Fu[List[VideoTag]] = catalogueCache.getUnit.zip(tagSettingsCache.getUnit).map(orderedTags)

    def find(name: Tag): Fu[Option[VideoTag]] = all.map(_.find(_.name == name))

    def save(value: VideoTag): Funit =
      tagColl.update
        .one(
          $id(value.name),
          $set("description" -> value.description, "videoIds" -> value.videoIds) ++
            $doc("$setOnInsert" -> $doc("sortOrder" -> value.sortOrder)),
          upsert = true
        )
        .void
        .map: _ =>
          tagSettingsCache.invalidateUnit()

    def setOrder(value: VideoTag, index: Int): Funit =
      tagColl.update
        .one(
          $id(value.name),
          $set("sortOrder" -> index) ++
            $doc("$setOnInsert" -> $doc("description" -> value.description, "videoIds" -> value.videoIds)),
          upsert = true
        )
        .void
        .map: _ =>
          tagSettingsCache.invalidateUnit()

    def paths(filterTags: List[Tag]): Fu[List[TagNb]] = pathsCache.get(filterTags.sorted)
    def allPopular: Fu[List[TagNb]] = popularTagsCache.getUnit

  private def quotedQuery(query: String) =
    query.split(' ').filter(_.nonEmpty).map(word => s"\"$word\"").mkString(" ")

  private def computeTagPaths(filterTags: List[Tag]): Fu[List[TagNb]] =
    val max = 25
    val allPaths =
      if filterTags.isEmpty then popularTagsCache.getUnit.map(_.filterNot(_.isNumeric))
      else
        videoColl
          .aggregateList(maxDocs = Int.MaxValue, _.sec): framework =>
            import framework.*
            Match(publishedSelector ++ $doc("tags".$all(filterTags))) -> List(
              Project($doc("tags" -> true)),
              UnwindField("tags"),
              GroupField("tags")("nb" -> SumAll)
            )
          .map(_.flatMap(_.asOpt[TagNb]))

    popularTagsCache.getUnit
      .zip(allPaths)
      .map: (all, paths) =>
        val tags = all
          .map(t => paths.find(_._id == t._id).getOrElse(TagNb(t._id, 0)))
          .filterNot(_.empty)
          .take(max)
        val missing = filterTags.filterNot(t => tags.exists(_.tag == t))
        (tags.take(max - missing.size) ::: missing.flatMap(t => all.find(_.tag == t))).sortBy: tag =>
          if filterTags.contains(tag.tag) then Int.MinValue else -tag.nb
