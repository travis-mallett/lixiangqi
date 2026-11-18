package lila.forum

import scalalib.paginator.*

import lila.common.Bus
import lila.common.String.noShouting
import lila.core.config.NetDomain
import lila.core.forum.BusForum.CreatePost
import lila.core.perm.Granter as MasterGranter
import lila.core.shutup.ShutupApi
import lila.core.chat.PublicSource
import lila.core.timeline.{ ForumPost as TimelinePost, Propagate }
import lila.core.id.ForumTopicSlug
import lila.db.dsl.{ *, given }
import lila.memo.CacheApi

final private class ForumTopicApi(
    postRepo: ForumPostRepo,
    topicRepo: ForumTopicRepo,
    categRepo: ForumCategRepo,
    mentionNotifier: MentionNotifier,
    paginator: ForumPaginator,
    modLog: lila.core.mod.LogApi,
    config: ForumConfig,
    spam: lila.core.security.SpamApi,
    promotion: lila.core.security.PromotionApi,
    shutupApi: lila.core.shutup.ShutupApi,
    media: ForumMedia,
    cacheApi: CacheApi,
    relationApi: lila.core.relation.RelationApi
)(using Executor):

  import BSONHandlers.given

  def showLastPage(categId: ForumCategId, slug: ForumTopicSlug)(using NetDomain)(using me: Option[Me]) =
    topicRepo
      .byTree(categId, slug)
      .flatMapz: topic =>
        show(categId, slug, topic.lastPage(config.postMaxPerPage))

  def show(categId: ForumCategId, slug: ForumTopicSlug, page: Int, countView: Boolean = true)(using
      NetDomain
  )(using me: Option[Me]): Fu[Option[(ForumCateg, ForumTopic, Paginator[ForumPost.WithFrag])]] =
    for
      data <- categRepo.byId(categId).flatMapz { categ =>
        topicRepo
          .forUser(me)
          .byTree(categId, slug)
          .dmap:
            _.map(categ -> _)
      }
      res <- data.so: (categ, topic) =>
        if countView then lila.mon.forum.topic.view.increment()
        paginator
          .topicPosts(topic, page)
          .flatMap: paginated =>
            val authors = paginated.currentPageResults.flatMap(_.post.userId)
            me.so(relationApi.filterBlocked(_, authors))
              .map: blockedAuthors =>
                (
                  categ,
                  topic,
                  paginated.mapResults: p =>
                    p.copy(hide = p.post.userId.so(blockedAuthors(_)))
                ).some
    yield res

  object findDuplicate:
    private val cache =
      cacheApi.notLoadingSync[(UserId, String), ForumTopicId](64, "forum.topic.duplicate"):
        _.expireAfterWrite(1.hour).build()
    def apply(topic: ForumTopic): Fu[Option[ForumTopic]] = topic.userId.so: uid =>
      val key = (uid, topic.name)
      cache
        .getIfPresent(key)
        .so { topicRepo.coll.byId[ForumTopic](_) }
        .orElse:
          cache.put(key, topic.id)
          fuccess(none)

  def makeTopic(
      categ: ForumCateg,
      data: ForumForm.TopicData
  )(using me: Me): Fu[ForumTopic] =
    if lila.core.security.SubmissionPolicy.blocked(data.automodText) then
      return fufail(lila.core.security.SubmissionRejected("unsafeLink"))
    topicRepo.nextSlug(categ, data.name).flatMap { slug =>
      val initial = ForumTopic.make(
        categId = categ.id,
        slug = slug,
        name = noShouting(data.name),
        userId = me,
        troll = me.marks.troll
      )
      val topic = data.post.nonce.fold(initial)(n =>
        initial
          .copy(id = ForumTopicId(lila.memo.Attachment.publicationId(me, media.audience(categ.id, None), n)))
      )
      val draft = ForumPost.make(
        topicId = topic.id,
        userId = me.some,
        troll = me.marks.troll,
        text = spam.replace(data.post.text),
        lang = me.lang.map(_.value.takeWhile(_ != '-')),
        categId = categ.id,
        modIcon = (~data.post.modIcon && MasterGranter(_.PublicMod)).option(true)
      )
      val post = draft.copy(
        id = media.postId(categ.id, None, data.post.nonce, draft.id),
        attachments = data.post.ids.nonEmptyOption,
        submissionDigest = data.post.digest(data.name)
      )
      val duplicate = if data.post.nonce.isDefined then topicRepo.byId(topic.id) else findDuplicate(topic)
      def replay(dup: ForumTopic): Fu[ForumTopic] =
        if data.post.nonce.isEmpty then fuccess(dup)
        else
          postRepo.coll
            .exists($id(post.id) ++ $doc("submissionDigest" -> post.submissionDigest))
            .flatMap(ok =>
              if ok then fuccess(dup) else fufail(lila.core.security.SubmissionRejected("conflict"))
            )
      duplicate.flatMap:
        case Some(dup) => replay(dup)
        case None =>
          val saved = for _ <- media.commit(categ.id, None, post.id, 0, data.post.ids) { tx =>
              val boards = media.records(categRepo.coll, tx)
              for
                current <- tx.fold(fuccess(categ))(_ =>
                  boards.byId[ForumCateg](categ.id).orFail("missing forum category")
                )
                _ <- media.records(topicRepo.coll, tx).insert.one(topic.withPost(post))
                _ <- boards.update.one($id(categ.id), current.withPost(topic, post))
                _ <- media.records(postRepo.coll, tx).insert.one(post)
              yield ()
            }
          yield
            promotion.save(me, post.text)
            val text = s"${topic.name} ${post.text}"
            if post.isTeam then shutupApi.teamForumMessage(me, text)
            else shutupApi.publicText(me, text, PublicSource.Forum(post.id))
            if !post.troll && !categ.quiet then
              lila.common.Bus.pub:
                Propagate(TimelinePost(me, topic.id, topic.name, post.id))
                  .toFollowersOf(me)
                  .withTeam(categ.team)
            lila.mon.forum.post.create.increment()
            mentionNotifier.notifyMentionedUsers(post, topic)
            Bus.pub(CreatePost(post.mini))
            topic.withPost(post)
          saved.recoverWith(
            lila.db.recoverDuplicateKey(_ =>
              topicRepo.byId(topic.id).flatMap {
                case Some(dup) => replay(dup)
                case None => fufail(lila.core.security.SubmissionRejected("conflict"))
              }
            )
          )
    }

  def makeUblogDiscuss(
      slug: ForumTopicSlug,
      name: String,
      url: Url,
      ublogId: UblogPostId,
      authorId: UserId
  ): Funit =
    categRepo.byId(ForumCateg.ublogId).flatMapz { categ =>
      val topic = ForumTopic.make(
        categId = categ.id,
        slug = slug,
        name = name,
        userId = authorId,
        ublogId = ublogId.some
      )
      makeNewTopic(
        categ,
        topic,
        ForumPost.make(
          topicId = topic.id,
          userId = authorId.some,
          text = s"Comments on $url",
          categId = categ.id
        )
      )
    }

  private def makeNewTopic(categ: ForumCateg, topic: ForumTopic, post: ForumPost) = for
    _ <- topicRepo.coll.insert.one(topic.withPost(post))
    _ <- categRepo.coll.update.one($id(categ.id), categ.withPost(topic, post))
    _ <- postRepo.coll.insert.one(post)
  yield Bus.pub(CreatePost(post.mini))

  def getSticky(categ: ForumCateg)(using me: Option[Me]): Fu[List[TopicView]] = for
    topics <- topicRepo.stickyByCateg(categ.id)
    views <- topics.sequentially: topic =>
      postRepo.coll
        .byId[ForumPost](topic.lastPostId(me))
        .map: post =>
          TopicView(categ, topic, post, topic.lastPage(config.postMaxPerPage), me)
  yield views

  def toggleClose(categ: ForumCateg, topic: ForumTopic)(using me: Me): Funit = for
    closedByMod <- closedByMod(topic)
    isMod = MasterGranter(_.ModerateForum)
    canToggle = isMod || !closedByMod
    _ <- canToggle.so(topicRepo.close(topic.id, topic.open, byMod = isMod))
    _ <- canToggle.so(modLog.toggleCloseTopic(categ.id, topic.slug, topic.open))
  yield ()

  def closedByMod(topic: ForumTopic)(using Me): Fu[Boolean] =
    topic.closed.so(topicRepo.closedByMod(topic.id))

  def toggleSticky(categ: ForumCateg, topic: ForumTopic)(using me: Me): Funit =
    topicRepo.sticky(topic.id, topic.sticky.isEmpty.option(me.userId)) >>
      MasterGranter(_.ModerateForum).so:
        modLog.toggleStickyTopic(categ.id, topic.slug, topic.sticky.isEmpty)

  private[forum] def denormalize(topic: ForumTopic): Funit = for
    nbPosts <- postRepo.countByTopic(topic)
    lastPost <- postRepo.lastByTopic(topic)
    nbPostsTroll <- postRepo.unsafe.countByTopic(topic)
    lastPostTroll <- postRepo.unsafe.lastByTopic(topic)
    _ <-
      topicRepo.coll.update
        .one(
          $id(topic.id),
          $set:
            ~lila.db.BSON.toBdoc:
              topic.copy(
                nbPosts = nbPosts,
                lastPostId = lastPost.fold(topic.lastPostId)(_.id),
                updatedAt = lastPost.fold(topic.updatedAt)(_.createdAt),
                nbPostsTroll = nbPostsTroll,
                lastPostIdTroll = lastPostTroll.fold(topic.lastPostIdTroll)(_.id),
                updatedAtTroll = lastPostTroll.fold(topic.updatedAtTroll)(_.createdAt)
              )
        )
        .void
  yield ()

  def removeTopic(categId: ForumCategId, slug: ForumTopicSlug): Funit =
    topicRepo
      .byTree(categId, slug)
      .flatMap:
        case None => funit
        case Some(topic) =>
          for
            _ <- postRepo.removeByTopic(topic.id)
            _ <- topicRepo.remove(topic)
            categOpt <- categRepo.byId(categId)
          yield categOpt.foreach: cat =>
            for
              topics <- topicRepo.byCateg(cat.id)
              lastPostId = topics.maxBy(_.updatedAt).lastPostId
              lastPostIdTroll = topics.maxBy(_.updatedAtTroll).lastPostIdTroll
              _ <- categRepo.coll.update
                .one($id(cat.id), cat.withoutTopic(topic, lastPostId, lastPostIdTroll))
            yield ()

  def relocate(fromTopic: ForumTopic, to: ForumCategId): Fu[ForumTopic] =
    val topic = fromTopic.copy(
      slug = fromTopic.slug.map(_ + "-" + scalalib.ThreadLocalRandom.nextString(4))
    )
    for
      _ <- topicRepo.coll.update.one($id(topic.id), $set("categId" -> to, "slug" -> topic.slug))
      _ <- postRepo.coll.update.one($doc("topicId" -> topic.id), $set("categId" -> to))
    yield topic
