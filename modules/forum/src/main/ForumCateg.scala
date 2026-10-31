package lila.forum

import reactivemongo.api.bson.Macros.Annotations.Key

case class ForumCateg(
    @Key("_id") id: ForumCategId, // slug
    name: String,
    desc: String,
    team: Option[TeamId] = None,
    nbTopics: Int,
    nbPosts: Int,
    lastPostId: ForumPostId,
    nbTopicsTroll: Int,
    nbPostsTroll: Int,
    lastPostIdTroll: ForumPostId,
    quiet: Boolean = false,
    hidden: Boolean = false
):
  def nbTopics(forUser: Option[User]): Int = if forUser.exists(_.marks.troll) then nbTopicsTroll else nbTopics
  def nbPosts(forUser: Option[User]): Int = if forUser.exists(_.marks.troll) then nbPostsTroll else nbPosts
  def lastPostId(forUser: Option[User]): ForumPostId =
    if forUser.exists(_.marks.troll) then lastPostIdTroll else lastPostId

  def isTeam = team.nonEmpty
  def isDiagnostic = id == ForumCateg.diagnosticId

  def withPost(topic: ForumTopic, post: ForumPost): ForumCateg =
    copy(
      // the `Topic` object is created before adding the post, hence why nbPosts is compared to 0 and not to 1
      nbTopics = if post.troll || topic.nbPosts > 0 then nbTopics else nbTopics + 1,
      nbPosts = if post.troll then nbPosts else nbPosts + 1,
      lastPostId = if post.troll || topic.isTooBig then lastPostId else post.id,
      nbTopicsTroll = if topic.nbPostsTroll == 0 then nbTopicsTroll + 1 else nbTopicsTroll,
      nbPostsTroll = nbPostsTroll + 1,
      lastPostIdTroll = if topic.isTooBig then lastPostIdTroll else post.id
    )

  def withoutTopic(topic: ForumTopic, lastPostId: ForumPostId, lastPostIdTroll: ForumPostId): ForumCateg =
    copy(
      nbTopics = nbTopics - 1,
      nbTopicsTroll = nbTopicsTroll - 1,
      nbPosts = nbPosts - topic.nbPosts,
      nbPostsTroll = nbPostsTroll - topic.nbPostsTroll,
      lastPostId = lastPostId,
      lastPostIdTroll = lastPostIdTroll
    )

object ForumCateg:

  export lila.core.forum.ForumCateg.*

  val ublogId = ForumCategId("community-blog-discussions")
  val diagnosticId = ForumCategId("diagnostic")

  // Site boards are provisioned by the repository; team boards are created with their team.
  val publicBoards: List[ForumCateg] = List(
    empty("general-xiangqi-discussion", "Xiangqi Discussion", "Discuss xiangqi strategy, news, and events."),
    empty("game-analysis", "Game Analysis", "Share games and analyse positions with the community."),
    empty(
      "lixiangqi-feedback",
      "LiXiangQi Feedback",
      "Report problems and suggest improvements to LiXiangQi."
    ),
    empty("off-topic-discussion", "Off-Topic", "Community discussions beyond xiangqi.")
  )

  val siteBoards: List[ForumCateg] = publicBoards ++ List(
    empty(ublogId.value, "Community Blog Discussions", "Discuss community blog posts.").copy(hidden = true),
    empty(diagnosticId.value, "Diagnostics", "Your diagnostic reports").copy(hidden = true, quiet = true)
  )

  private def empty(id: String, name: String, desc: String): ForumCateg = ForumCateg(
    id = ForumCategId(id),
    name = name,
    desc = desc,
    nbTopics = 0,
    nbPosts = 0,
    lastPostId = ForumPostId(""),
    nbTopicsTroll = 0,
    nbPostsTroll = 0,
    lastPostIdTroll = ForumPostId("")
  )

  def fromTeamId(id: TeamId): ForumCategId = ForumCategId(s"team-$id")
