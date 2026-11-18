package lila.forum

import lila.core.security.SubmissionRejected
import lila.common.Bus
import lila.core.forum.{ ForumCateg as _, ForumPost as _, * }
import lila.core.perm.Granter as MasterGranter
import lila.core.shutup.ShutupApi
import lila.core.chat.PublicSource
import lila.core.timeline.{ ForumPost as TimelinePost, Propagate }
import lila.db.dsl.{ *, given }

final class ForumPostApi(
    postRepo: ForumPostRepo,
    topicRepo: ForumTopicRepo,
    categRepo: ForumCategRepo,
    mentionNotifier: MentionNotifier,
    modLog: lila.core.mod.LogApi,
    config: ForumConfig,
    spam: lila.core.security.SpamApi,
    promotion: lila.core.security.PromotionApi,
    shutupApi: lila.core.shutup.ShutupApi,
    media: ForumMedia,
    access: ForumAccess,
    picfitApi: lila.memo.PicfitApi,
    relationApi: lila.core.relation.RelationApi
)(using Executor)(using scheduler: Scheduler)
    extends lila.core.forum.ForumPostApi:

  import BSONHandlers.given

  def makePost(
      categ: ForumCateg,
      topic: ForumTopic,
      data: ForumForm.PostData
  )(using me: Me): Fu[ForumPost] = for
    _ <- Future(lila.core.security.SubmissionPolicy.check(data.text))
    ids = data.ids
    publicMod = MasterGranter(_.PublicMod)
    modIcon = ~data.modIcon && (publicMod || MasterGranter(_.SeeReport))
    anonMod = modIcon && !publicMod
    raw = ForumPost.make(
      topicId = topic.id,
      userId = (!anonMod).option(me),
      text = spam.replace(data.text),
      lang = me.lang.map(_.value.takeWhile(_ != '-')),
      troll = me.marks.troll,
      categId = categ.id,
      modIcon = modIcon.option(true)
    )
    post = raw.copy(
      id = media.postId(categ.id, Some(topic.id), data.nonce, raw.id),
      attachments = ids.nonEmptyOption,
      submissionDigest = data.digest()
    )
    dup <- if data.nonce.isDefined then getPost(post.id) else postRepo.findDuplicate(post)
    post <- dup match
      case Some(dup) if data.nonce.isDefined && dup.submissionDigest != post.submissionDigest =>
        fufail(SubmissionRejected("conflict"))
      case Some(dup) if data.nonce.isDefined || !post.modIcon.getOrElse(false) => fuccess(dup)
      case _ =>
        val saved = for _ <- media.commit(categ.id, Some(topic.id), post.id, 0, ids) { tx =>
            val topics = media.records(topicRepo.coll, tx)
            val boards = media.records(categRepo.coll, tx)
            for
              currentTopic <- tx.fold(fuccess(topic))(_ =>
                topics.byId[ForumTopic](topic.id).orFail("missing forum topic")
              )
              currentCateg <- tx.fold(fuccess(categ))(_ =>
                boards.byId[ForumCateg](categ.id).orFail("missing forum category")
              )
              _ <- media.records(postRepo.coll, tx).insert.one(post)
              _ <- topics.update.one($id(topic.id), currentTopic.withPost(post))
              _ <- boards.update.one($id(categ.id), currentCateg.withPost(currentTopic, post))
            yield ()
          }
        yield
          promotion.save(me, post.text)
          if post.isTeam
          then shutupApi.teamForumMessage(me, post.text)
          else shutupApi.publicText(me, post.text, PublicSource.Forum(post.id))
          def interestedUsers = for
            recentUsers <- recentUserIds(topic)
            blockingUsers <- relationApi.filterBlocking(recentUsers, me.userId)
          yield recentUsers.filterNot(blockingUsers.contains)
          if anonMod
          then logAnonPost(post, edit = false)
          else if !post.troll && !categ.quiet then
            interestedUsers.foreach: propagateTo =>
              lila.common.Bus.pub:
                Propagate(TimelinePost(me, topic.id, topic.name, post.id))
                  .toFollowersOf(me)
                  .toUsers(propagateTo)
                  .exceptUser(me)
                  .withTeam(categ.team)
          else if categ.id == ForumCateg.diagnosticId then
            interestedUsers.foreach: propagateTo =>
              lila.common.Bus.pub:
                Propagate(TimelinePost(me, topic.id, topic.name, post.id))
                  .toUsers(propagateTo)
                  .exceptUser(me)
          lila.mon.forum.post.create.increment()
          mentionNotifier.notifyMentionedUsers(post, topic)
          Bus.pub(BusForum.CreatePost(post.mini))
          post
        saved.recoverWith(
          lila.db.recoverDuplicateKey(_ =>
            getPost(post.id).flatMap {
              case Some(found) if data.nonce.isDefined && found.submissionDigest == post.submissionDigest =>
                fuccess(found)
              case _ => fufail(SubmissionRejected("conflict"))
            }
          )
        )
  yield post

  def editPost(
      postId: ForumPostId,
      newText: String,
      expected: Option[Long] = None,
      attachmentIds: Option[List[String]] = None
  )(using me: Me): Fu[ForumPost] =
    if lila.core.security.SubmissionPolicy.blocked(newText) then
      return fufail(lila.core.security.SubmissionRejected("unsafeLink"))
    get(postId).flatMap: post =>
      post.fold[Fu[ForumPost]](fufail("Post no longer exists.")):
        case (_, post) if !post.canBeEditedByMe =>
          fufail("You are not authorized to modify this post.")
        case (_, post) if !post.canStillBeEdited =>
          fufail("Post can no longer be edited")
        case (topic, post) =>
          val revision = post.contentRevision.getOrElse(0L)
          val ids = attachmentIds.getOrElse(~post.attachments)
          val next = post.editPost(nowInstant, spam.replace(newText)).copy(attachments = ids.nonEmptyOption)
          val changed = next.text != post.text || next.attachments != post.attachments
          for
            allowed <- access.isGrantedWrite(topic.categId, tryingToPostAsMod = post.isAnonModPost)(using
              Some(me)
            )
            mod <- access.isGrantedMod(topic.categId)(using Some(me))
            blocked <- access.isReplyBlockedOnUBlog(topic, mod)
            _ <-
              if !allowed || blocked || topic.closed || topic.isOld || post.erased then
                fufail(SubmissionRejected("rejected"))
              else if expected.exists(_ != revision) then fufail(SubmissionRejected("conflict"))
              else if newText.trim.length < 3 && ids.isEmpty then fufail(SubmissionRejected("invalid"))
              else funit
            _ <- changed.so {
              media
                .commit(
                  topic.categId,
                  Some(topic.id),
                  post.id,
                  revision + 1,
                  ids,
                  (~post.attachments).toSet
                ) { tx =>
                  val guard = $id(post.id) ++ $doc("erasedAt".$exists(false)) ++ post.contentRevision.fold(
                    $doc("contentRevision".$exists(false))
                  )(v => $doc("contentRevision" -> v))
                  media
                    .records(postRepo.coll, tx)
                    .update
                    .one(
                      guard,
                      $set(
                        "text" -> next.text,
                        "updatedAt" -> next.updatedAt,
                        "editHistory" -> next.editHistory,
                        "contentRevision" -> next.contentRevision,
                        "attachments" -> ids,
                        "reactions" -> next.reactions
                      )
                    )
                    .flatMap: res =>
                      if res.nModified != 1 then fufail(SubmissionRejected("conflict"))
                      else funit
                }
                .flatMap(_ =>
                  next.isAnonModPost
                    .so(logAnonPost(next, edit = true))
                    .map(_ => promotion.save(me, next.text))
                )
            }
          yield if changed then next else post

  def urlData(postId: ForumPostId, forUser: Option[User]): Fu[Option[PostUrlData]] =
    get(postId).flatMap:
      case Some(_, post) if !post.visibleBy(forUser) => fuccess(none[PostUrlData])
      case Some(topic, post) =>
        postRepo.forUser(forUser).countBeforePost(post).dmap { nb =>
          val page = nb / config.postMaxPerPage.value + 1
          PostUrlData(topic.categId, topic.slug, page, post.id).some
        }
      case _ => fuccess(none)

  def get(postId: ForumPostId): Fu[Option[(ForumTopic, ForumPost)]] =
    getPost(postId).flatMapz: post =>
      topicRepo.byId(post.topicId).dmap2(_ -> post)

  def getPost(postId: ForumPostId): Fu[Option[ForumPost]] =
    postRepo.coll.byId[ForumPost](postId)

  def react(
      categId: ForumCategId,
      postId: ForumPostId,
      reactionStr: String,
      v: Boolean
  )(using me: Me): Fu[Option[ForumPost]] =
    ForumPost.Reaction(reactionStr).so { reaction =>
      if v then lila.mon.forum.reaction(reaction.key).increment()
      for
        post <- postRepo.coll
          .findAndUpdateSimplified[ForumPost](
            selector = $id(postId) ++ $doc("categId" -> categId, "userId".$ne(me.userId)),
            update =
              if v then $addToSet(s"reactions.$reaction" -> me.userId)
              else $pull(s"reactions.$reaction" -> me.userId),
            fetchNewObject = true
          )
        _ =
          if me.marks.troll && reaction == ForumPost.Reaction.MinusOne && v
          then
            scheduler.scheduleOnce(5.minutes):
              react(categId, postId, reaction.key, false)
      yield post
    }

  def views(posts: Seq[ForumPost]): Fu[List[PostView]] =
    for
      topics <- topicRepo.coll.byIds[ForumTopic, ForumTopicId](posts.map(_.topicId).distinct)
      categs <- categRepo.coll.byIds[ForumCateg, ForumCategId](topics.map(_.categId).distinct)
    yield posts.toList.flatMap: post =>
      for
        topic <- topics.find(_.id == post.topicId)
        categ <- categs.find(_.id == topic.categId)
      yield PostView(post, topic, categ)

  def viewsFromIds(postIds: Seq[ForumPostId]): Fu[List[PostView]] =
    postRepo.coll.byOrderedIds[ForumPost, ForumPostId](postIds)(_.id).flatMap(views)

  def viewOf(post: ForumPost): Fu[Option[PostView]] =
    views(List(post)).dmap(_.headOption)

  def miniViews(postIds: List[ForumPostId]): Fu[List[ForumPostMiniView]] = postIds.nonEmpty.so:
    for
      posts <- postRepo.miniByIds(postIds)
      topics <- topicRepo.coll.byStringIds[ForumTopicMini](posts.map(_.topicId.value).distinct)
    yield posts.flatMap: post =>
      topics.find(_.id == post.topicId).map { ForumPostMiniView(post, _) }

  def toMiniViews(posts: List[ForumPostMini]): Fu[List[ForumPostMiniView]] = posts.nonEmpty.so:
    topicRepo
      .byIds(posts.map(_.topicId))
      .map: topics =>
        posts.flatMap: post =>
          topics.find(_.id == post.topicId).map { ForumPostMiniView(post, _) }

  def toMiniView(post: ForumPost): Fu[Option[ForumPostMiniView]] =
    toMiniViews(List(post.mini)).dmap(_.headOption)

  def toMiniView(post: ForumPostMini): Fu[Option[ForumPostMiniView]] =
    miniViews(List(post.id)).dmap(_.headOption)

  def miniPosts(posts: List[ForumPost]): Fu[List[ForumPostMiniView]] =
    topicRepo
      .byIds(posts.map(_.topicId))
      .map: topics =>
        posts.flatMap: post =>
          topics
            .find(_.id == post.topicId)
            .map: topic =>
              ForumPostMiniView(post = post.mini, topic = topic)

  def allUserIds(topicId: ForumTopicId) = postRepo.allUserIdsByTopicId(topicId)

  def nbByUser(userId: UserId) = postRepo.coll.secondary.countSel($doc("userId" -> userId))

  def categsForUser(teams: Iterable[TeamId], forUser: Option[User]): Fu[List[CategView]] =
    val isMod = forUser.fold(false)(MasterGranter.of(_.ModerateForum))
    for
      categs <- categRepo.visibleWithTeams(teams, forUser)
      diagnostic <- if isMod then fuccess(none) else forUser.so(diagnosticForUser)
      views <- categs
        .parallel: categ =>
          get(categ.lastPostId(forUser)).map: topicPost =>
            CategView(
              categ,
              topicPost.map { case (topic, post) => (topic, post, topic.lastPage(config.postMaxPerPage)) },
              forUser
            )
    yield views ++ diagnostic.toList

  private def diagnosticForUser(user: User): Fu[Option[CategView]] = // CategView with user's topic/post
    for
      categOpt <- categRepo.byId(ForumCateg.diagnosticId)
      topicOpt <- topicRepo.byTree(ForumCateg.diagnosticId, ForumTopic.problemReportSlug(user.id))
      postOpt <- topicOpt.so(t => postRepo.coll.byId[ForumPost](t.lastPostId(user.some)))
    yield
      for
        post <- postOpt
        topic <- topicOpt
        categ <- categOpt
      yield CategView(categ, (topic, post, topic.lastPage(config.postMaxPerPage)).some, user.some)

  private def recentUserIds(topic: ForumTopic) =
    postRepo.coll
      .distinctEasy[UserId, List](
        "userId",
        $doc(
          "topicId" -> topic.id,
          "createdAt".$gt(nowInstant.minusDays(2))
        ),
        _.sec
      )

  def erasePost(post: ForumPost) =
    for
      _ <- picfitApi.pullRef(picRef(post.id))
      _ <- postRepo.coll.update.one($id(post.id), post.erase)
    yield ()

  def teamIdOfPost(post: ForumPost): Fu[Option[TeamId]] =
    categRepo.coll.primitiveOne[TeamId]($id(post.categId), "team")

  private def logAnonPost(post: ForumPost, edit: Boolean)(using Me): Funit =
    topicRepo.byId(post.topicId).orFail(s"No such topic ${post.topicId}").flatMap { topic =>
      modLog.postOrEditAsAnonMod(
        post.categId,
        topic.slug,
        post.id,
        post.text,
        edit
      )
    }
