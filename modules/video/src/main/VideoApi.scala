package lila.video

import reactivemongo.api.bson.*
import scalalib.paginator.*

import lila.db.dsl.{ *, given }
import lila.db.paginator.Adapter
import lila.memo.CacheApi.*

final private[video] class VideoApi(
    videoColl: Coll,
    viewColl: Coll,
    cacheApi: lila.memo.CacheApi
)(using Executor, Scheduler):

  import BsonHandlers.given
  private given BSONDocumentHandler[TagNb] = Macros.handler
  import View.given

  private val publishedSelector = $or(
    $doc("status" -> VideoStatus.Published.key),
    $doc("status".$exists(false))
  )

  private def statusSelector(status: VideoStatus): Bdoc =
    if status == VideoStatus.Published then publishedSelector
    else $doc("status" -> status.key)

  private val publicSort = $doc("sortOrder" -> 1, "createdAt" -> -1)

  private val countCache = cacheApi.unit[Long]("video.count"):
    _.refreshAfterWrite(3.hours).buildAsyncTimeout()(_ => videoColl.countSel(publishedSelector).map(_.toLong))

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
    countCache.invalidateUnit()
    pathsCache.invalidateAll()
    popularTagsCache.invalidateUnit()

  private def videoViews(userOption: Option[UserId])(videos: Seq[Video]): Fu[Seq[VideoView]] =
    userOption match
      case None => fuccess(videos.map(VideoView(_, view = false)))
      case Some(user) =>
        view
          .seenVideoIds(user, videos)
          .map: ids =>
            videos.map(v => VideoView(v, ids.contains(v.id)))

  object video:

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

    def popular(user: Option[UserId], page: Int): Fu[Paginator[VideoView]] =
      publicPager(user, publishedSelector, page)

    def byTags(user: Option[UserId], tags: List[Tag], page: Int): Fu[Paginator[VideoView]] =
      if tags.isEmpty then popular(user, page)
      else publicPager(user, publishedSelector ++ $doc("tags".$all(tags)), page)

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

    def count: Fu[Long] = countCache.getUnit

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
      videoColl.find(publishedSelector).sort(publicSort).cursor[Video]().list(5000)

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
