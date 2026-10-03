package lila.tree

import lila.xiangqi.XiangqiGlyph.{ Glyph, Glyphs }

import scala.annotation.tailrec
import alleycats.Zero
import chess.format.pgn.Comment as CommentStr
import chess.format.Fen
import lila.xiangqi.{ Xiangqi, XiangqiRules, UciPath }
import lila.xiangqi.Xiangqi.{ Uci, Move, Side }
import lila.xiangqi.XiangqiJson.given
import lila.xiangqi.adjudication.Ruleset
import chess.{ Centis, Ply }
import play.api.libs.json.*
import scalalib.StringOps.softCleanUp
import scalalib.ThreadLocalRandom
import scalalib.json.Json.given

import Node.{ Comments, Comment, Gamebook, Shapes }

// Child order is stable; the first child not marked as a variation is the mainline.
opaque type Branches = List[Branch]
object Branches:

  def apply(branches: List[Branch]): Branches = branches
  val empty: Branches = Nil
  given Zero[Branches] = Zero(empty)

  extension (nodes: Branches)
    def toList: List[Branch] = nodes
    def first = mainlineFirst
    def mainlineFirst = nodes.collectFirst:
      case node if !node.forceVariation => node
    def variations = mainlineFirst.fold(nodes)(main => nodes.filterNot(_.id == main.id))
    def isEmpty = nodes.isEmpty
    def nonEmpty = !isEmpty
    def maxDepth: Int = if nodes.isEmpty then 0 else 1 + nodes.map(_.children.maxDepth).max

    def get(id: Uci): Option[Branch] = nodes.find(_.id == id)
    def hasNode(id: Uci): Boolean = nodes.exists(_.id == id)

    def nodeAt(path: UciPath): Option[Branch] =
      path.split.flatMap: (head, rest) =>
        rest.computeIds.foldLeft(get(head)): (cur, id) =>
          cur.flatMap(_.children.get(id))

    // select all nodes on that path
    def nodesOn(path: UciPath): Vector[(Branch, UciPath)] =
      path.split.so: (head, tail) =>
        get(head).so: first =>
          (first, UciPath.fromId(head)) +: first.children.nodesOn(tail).map { (n, p) =>
            (n, p.prepend(head))
          }

    def addNodeAt(node: Branch, path: UciPath): Option[Branches] =
      path.split.fold(addNode(node).some): (head, tail) =>
        updateChildren(head, _.addNodeAt(node, tail))

    // suboptimal due to using List instead of Vector
    def addNode(node: Branch): Branches =
      get(node.id).fold(nodes :+ node): prev =>
        nodes.map(n => if n.id == node.id then prev.merge(node) else n)

    // doesn't check if a node with the same ID exists!
    def prependUnchecked(b: Branch): Branches = b :: nodes

    def deleteNodeAt(path: UciPath): Option[Branches] =
      path.split.flatMap:
        case (head, p) if p.isEmpty && hasNode(head) => nodes.filterNot(_.id == head).some
        case (_, p) if p.isEmpty => none
        case (head, tail) => updateChildren(head, _.deleteNodeAt(tail))

    def promoteToMainlineAt(path: UciPath): Option[Branches] =
      path.split.fold(nodes.some): (head, tail) =>
        for
          node <- get(head)
          promoted <- node.withChildren(_.promoteToMainlineAt(tail))
        yield promoted.copy(forceVariation = false) :: nodes.filterNot(_.id == node.id)

    def promoteUpAt(path: UciPath): Option[(Branches, Boolean)] =
      path.split.fold(Some(nodes -> false)): (head, tail) =>
        for
          node <- get(head)
          mainlineNode <- nodes.first
          (newChildren, isDone) <- node.children.promoteUpAt(tail)
          newNode = node.copy(children = newChildren)
        yield
          if isDone then update(newNode) -> true
          else if newNode.id == mainlineNode.id then update(newNode) -> false
          else (newNode.copy(forceVariation = false) :: nodes.filterNot(_.id == newNode.id)) -> true

    def updateAt(path: UciPath, f: Branch => Branch): Option[Branches] =
      path.split.flatMap:
        case (head, p) if p.isEmpty => updateWith(head, n => Some(f(n)))
        case (head, tail) => updateChildren(head, _.updateAt(tail, f))

    def updateAllWith(op: Branch => Branch): Branches =
      nodes.map: n =>
        op(n.copy(children = n.children.updateAllWith(op)))

    def update(child: Branch): Branches =
      nodes.map: n =>
        if child.id == n.id then child else n

    def updateWith(id: Uci, op: Branch => Option[Branch]): Option[Branches] =
      get(id).flatMap(op).map(update)

    def updateChildren(id: Uci, f: Branches => Option[Branches]): Option[Branches] =
      updateWith(id, _.withChildren(f))

    def updateMainline(f: Branch => Branch): Branches =
      mainlineFirst.fold(nodes) { main =>
        val changed = f(main)
        update(changed.copy(children = changed.children.updateMainline(f)))
      }

    def takeMainlineWhile(f: Branch => Boolean): Branches =
      updateMainline: node =>
        node.children.first.fold(node): mainline =>
          if f(mainline) then node
          else node.withoutChildren

    def countRecursive: Int =
      nodes.foldLeft(nodes.size): (count, n) =>
        count + n.children.countRecursive

    def lastMainlineNode: Option[Node] =
      first.map: first =>
        first.children.lastMainlineNode | first

sealed trait Node:
  def state: Xiangqi.State
  def ply: Ply = Ply(state.ply)
  def fen: Fen.Full = Fen.Full(state.fen)
  def eval: Option[Eval]
  def shapes: Node.Shapes
  def comments: Node.Comments
  def gamebook: Option[Node.Gamebook]
  def glyphs: Glyphs
  def children: Branches
  def comp: Boolean // generated by a computer analysis
  def addChild(branch: Branch): Node
  def clock: Option[Clock]
  def forceVariation: Boolean
  def result: Option[Xiangqi.RecordedResult]
  def elapsed: Option[Centis]
  def evaluationDepth: Option[Int]
  def mergeAnnotations(source: Node): Node

  // implementation dependent
  def idOption: Option[Uci]
  def moveOption: Option[Move]

  // who's color plays next
  def color: Side = state.turn

  def mainlineNodeList: List[Node] =
    this :: children.first.fold(List.empty[Node])(_.mainline)

case class Root(
    state: Xiangqi.State,
    ruleset: Ruleset = Ruleset.Unrestricted,
    result: Option[Xiangqi.RecordedResult] = None,
    elapsed: Option[Centis] = None,
    evaluationDepth: Option[Int] = None,
    eval: Option[Eval] = None,
    shapes: Node.Shapes = Node.Shapes(Nil),
    comments: Node.Comments = Node.Comments(Nil),
    gamebook: Option[Node.Gamebook] = None,
    glyphs: Glyphs = Glyphs.empty,
    children: Branches = Branches.empty,
    clock: Option[Clock] = None // clock state at game start, assumed same for both players
) extends Node:

  def idOption = None
  def moveOption = None
  def comp = false
  def forceVariation = false

  def addChild(child: Branch): Root = copy(children = children.addNode(child))
  def prependChildUnchecked(branch: Branch) = copy(children = children.prependUnchecked(branch))

  def withChildren(f: Branches => Option[Branches]): Option[Root] =
    f(children).map: newChildren =>
      copy(children = newChildren)

  def withoutChildren = copy(children = Branches.empty)

  def nodeAt(path: UciPath): Option[Node] =
    if path.isEmpty then this.some else children.nodeAt(path)

  def pathExists(path: UciPath): Boolean = nodeAt(path).isDefined

  def gameAt(path: UciPath): Either[String, Xiangqi.Game] =
    path.computeIds
      .foldLeft[Either[String, (Xiangqi.Game, Node)]](
        Right(Xiangqi.Game(fen.value, Vector.empty, Vector.empty, Vector(state), ruleset) -> this)
      ) { (result, id) =>
        result.flatMap { (game, node) =>
          node.children.get(id).toRight(s"Unknown study path: ${path.value}").map { child =>
            game.copy(
              moves = game.moves :+ child.move.uci,
              wxf = game.wxf :+ child.move.notation,
              states = game.states :+ child.state
            ) -> child
          }
        }
      }
      .map(_._1)

  def setShapesAt(shapes: Shapes, path: UciPath): Option[Root] =
    if path.isEmpty then copy(shapes = shapes).some
    else updateChildrenAt(path, _.setShapes(shapes))

  def setCommentAt(comment: Comment, path: UciPath): Option[Root] =
    if path.isEmpty then copy(comments = comments.set(comment)).some
    else updateChildrenAt(path, _.setComment(comment))

  def deleteCommentAt(commentId: Comment.Id, path: UciPath): Option[Root] =
    if path.isEmpty then copy(comments = comments.delete(commentId)).some
    else updateChildrenAt(path, _.deleteComment(commentId))

  def setGamebookAt(gamebook: Gamebook, path: UciPath): Option[Root] =
    if path.isEmpty then copy(gamebook = gamebook.some).some
    else updateChildrenAt(path, _.setGamebook(gamebook))

  def toggleGlyphAt(glyph: Glyph, path: UciPath): Option[Root] =
    if path.isEmpty then copy(glyphs = glyphs.toggle(glyph)).some
    else updateChildrenAt(path, _.toggleGlyph(glyph))

  def setClockAt(clock: Option[Clock], path: UciPath): Option[Root] =
    if path.isEmpty then copy(clock = clock).some
    else updateChildrenAt(path, _.withClock(clock))

  def forceVariationAt(force: Boolean, path: UciPath): Option[Root] =
    if path.isEmpty then None
    else updateChildrenAt(path, _.withForceVariation(force))

  private def updateChildrenAt(path: UciPath, f: Branch => Branch): Option[Root] =
    withChildren(_.updateAt(path, f))

  def updateMainlineLast(f: Branch => Branch): Root =
    children.first.fold(this) { main =>
      copy(children = children.update(main.updateMainlineLast(f)))
    }

  def clearAnnotationsRecursively =
    copy(
      comments = Comments(Nil),
      shapes = Shapes(Nil),
      glyphs = Glyphs.empty,
      children = children.updateAllWith(_.clearAnnotations)
    )

  def clearVariations =
    copy(
      children = children.first.fold(Branches.empty) { child =>
        Branches(List(child.clearVariations))
      }
    )

  // NOT `Branches` as it does not represent one mainline move and variations
  // but only mainline moves
  lazy val mainline: List[Branch] = children.first.so(_.mainline)

  def lastMainlinePly = mainline.lastOption.fold(ply)(_.ply)

  def lastMainlinePlyOf(path: UciPath) =
    mainline
      .zip(path.computeIds)
      .takeWhile { (node, id) => node.id == id }
      .lastOption
      .fold(ply) { (node, _) => node.ply }

  def mainlinePath = UciPath.fromIds(mainline.map(_.id))

  def lastMainlineNode: Node = children.lastMainlineNode.getOrElse(this)

  def takeMainlineWhile(f: Branch => Boolean) =
    if children.first.isDefined
    then copy(children = children.takeMainlineWhile(f))
    else this

  def mergeAnnotations(n: Node): Root = copy(
    shapes = shapes ++ n.shapes,
    comments = comments ++ n.comments,
    gamebook = n.gamebook.orElse(gamebook),
    result = n.result.orElse(result),
    elapsed = n.elapsed.orElse(elapsed),
    evaluationDepth = n.evaluationDepth.orElse(evaluationDepth),
    glyphs = glyphs.merge(n.glyphs),
    eval = n.eval.orElse(eval)
  )

  def merge(n: Root): Root =
    require(
      state == n.state && ruleset == n.ruleset,
      "Cannot merge trees with different starting positions or rulesets"
    )
    mergeAnnotations(n).copy(
      clock = n.clock.orElse(clock),
      children = n.children.toList.foldLeft(children)(_.addNode(_))
    )

  override def toString = s"$ply $children"

object Root:
  def default: Root =
    fromPosition(Xiangqi.Position()).fold(error => throw IllegalArgumentException(error), identity)

  def fromPosition(position: Xiangqi.Position): Either[String, Root] =
    XiangqiRules.game(position).map(fromGame)

  def fromGame(game: Xiangqi.Game): Root =
    val children = game.moves.zipWithIndex.foldRight(Branches.empty) { case ((move, index), next) =>
      Branches(
        List(
          Branch(game.states(index + 1), Move(move, game.wxf(index), game.chineseWxf(index)), children = next)
        )
      )
    }
    Root(game.states.head, game.ruleset, children = children)

case class Clock(centis: Centis, trust: Option[Boolean] = none):
  def positive = centis >= Centis(0)

case class Branch(
    state: Xiangqi.State,
    move: Move,
    result: Option[Xiangqi.RecordedResult] = None,
    elapsed: Option[Centis] = None,
    evaluationDepth: Option[Int] = None,
    eval: Option[Eval] = None,
    shapes: Node.Shapes = Node.Shapes(Nil),
    comments: Node.Comments = Node.Comments(Nil),
    gamebook: Option[Node.Gamebook] = None,
    glyphs: Glyphs = Glyphs.empty,
    children: Branches = Branches.empty, // Vector used in `Study.Node`, switch?
    comp: Boolean = false,
    clock: Option[Clock] = None, // clock state after the move is played, and the increment applied
    forceVariation: Boolean = false // cannot be mainline
) extends Node:

  val id = move.uci
  def idOption = Some(id)
  def moveOption = Some(move)

  // NOT `Branches` as it does not represent one mainline move and variations
  // but only mainline moves
  def mainline: List[Branch] =
    mainlineReverse.reverse

  /*
   * Return all nodes in the mainline but in reverse order
   * Could be useful as a building block for other operations
   */
  final def mainlineReverse: List[Branch] =
    @tailrec
    def loop(tree: Branch, acc: List[Branch]): List[Branch] =
      tree.children.first match
        case Some(child) => loop(child, tree :: acc)
        case None => tree :: acc
    loop(this, Nil)

  def withChildren(f: Branches => Option[Branches]) =
    f(children).map { newChildren =>
      copy(children = newChildren)
    }

  def withoutChildren = copy(children = Branches.empty)

  def addChild(branch: Branch): Branch = copy(children = children.addNode(branch))

  def withClock(clock: Option[Clock]) = copy(clock = clock)
  def withForceVariation(force: Boolean) = copy(forceVariation = force)

  def isCommented = comments.value.nonEmpty
  def setComment(comment: Comment) = copy(comments = comments.set(comment))
  def deleteComment(commentId: Comment.Id) = copy(comments = comments.delete(commentId))
  def deleteComments = copy(comments = Comments.empty)
  def setGamebook(gamebook: Gamebook) = copy(gamebook = gamebook.some)
  def setShapes(s: Shapes) = copy(shapes = s)
  def toggleGlyph(glyph: Glyph) = copy(glyphs = glyphs.toggle(glyph))

  def updateMainlineLast(f: Branch => Branch): Branch =
    children.first.fold(f(this)) { main =>
      copy(children = children.update(main.updateMainlineLast(f)))
    }

  def clearAnnotations =
    copy(
      comments = Comments(Nil),
      shapes = Shapes(Nil),
      glyphs = Glyphs.empty
    )

  def clearVariations: Branch =
    copy(
      children = children.first.fold(Branches.empty) { child => Branches(List(child.clearVariations)) }
    )

  def prependChildUnchecked(branch: Branch) = copy(children = children.prependUnchecked(branch))

  def setComp = copy(comp = true)

  def mergeAnnotations(n: Node): Branch = copy(
    shapes = shapes ++ n.shapes,
    comments = comments ++ n.comments,
    gamebook = n.gamebook.orElse(gamebook),
    result = n.result.orElse(result),
    elapsed = n.elapsed.orElse(elapsed),
    evaluationDepth = n.evaluationDepth.orElse(evaluationDepth),
    glyphs = glyphs.merge(n.glyphs),
    eval = n.eval.orElse(eval)
  )

  def merge(n: Branch): Branch =
    require(id == n.id && state == n.state, "Cannot merge different moves or branch histories")
    mergeAnnotations(n).copy(
      clock = n.clock.orElse(clock),
      children = n.children.toList.foldLeft(children)(_.addNode(_)),
      forceVariation = n.forceVariation || forceVariation
    )

  override def toString = s"$ply.${move.notation} (Branches: $children)"

object Node:

  type Shape = lila.xiangqi.XiangqiAnnotations.Shape
  val Shape = lila.xiangqi.XiangqiAnnotations.Shape

  opaque type Shapes = List[Shape]
  object Shapes extends TotalWrapper[Shapes, List[Shape]]:
    extension (a: Shapes) def ++(shapes: Shapes): Shapes = (a.value ::: shapes.value).distinct
    val empty: Shapes = Nil

  case class Comment(id: Comment.Id, text: CommentStr, by: Comment.Author):
    def toAnnotation =
      lila.xiangqi.XiangqiAnnotations.Comment(text.value, Some(id.value), Some(by.toAnnotation))

  object Comment:
    opaque type Id = String
    object Id extends OpaqueString[Id]:
      def make = Id(ThreadLocalRandom.nextString(4))

    enum Author:
      case User(id: UserId, titleName: String)
      case External(name: String)
      case Site
      case Unknown

      def is(other: Author) = (this, other) match
        case (User(a, _), User(b, _)) => a == b
        case _ => this == other

      def toAnnotation: lila.xiangqi.XiangqiAnnotations.Author =
        import lila.xiangqi.XiangqiAnnotations.Author as A
        this match
          case User(id, name) => A("user", Some(id.value), Some(name))
          case External(name) => A("external", name = Some(name))
          case Site => A("site")
          case Unknown => A("unknown")

    def fromAnnotation(annotation: lila.xiangqi.XiangqiAnnotations.Comment, defaultAuthor: Author): Comment =
      val author = annotation.by.fold(defaultAuthor): by =>
        by.kind match
          case "user" => Author.User(UserId(by.id.get), by.name.get)
          case "external" => Author.External(by.name.get)
          case "site" => Author.Site
          case "unknown" => Author.Unknown
          case _ => throw IllegalArgumentException("Invalid comment author")
      Comment(annotation.id.fold(Id.make)(Id.apply), CommentStr(annotation.text), author)

    def sanitize(text: String) =
      require(text.length <= 4000, "Comments must contain at most 4000 characters")
      CommentStr(
        softCleanUp(text)
          .replaceAll("""\r\n""", "\n") // these 3 lines dedup white spaces and new lines
          .replaceAll("""(?m)(^ *| +(?= |$))""", "")
          .replaceAll("""(?m)^$([\n]+?)(^$[\n]+?^)+""", "$1")
      )

  opaque type Comments = List[Comment]
  object Comments extends TotalWrapper[Comments, List[Comment]]:
    extension (a: Comments)
      def findBy(author: Comment.Author) = a.value.find(_.by.is(author))
      def set(comment: Comment): Comments =
        if a.value.exists(_.by.is(comment.by)) then
          a.value.map:
            case c if c.by.is(comment.by) => c.copy(text = comment.text, by = comment.by)
            case c => c
        else a.value :+ comment
      def delete(commentId: Comment.Id): Comments = a.value.filterNot(_.id == commentId)
      def +(comment: Comment): Comments = comment :: a.value
      def ++(comments: Comments): Comments = comments.value.foldLeft(a.value) { (acc, comment) =>
        if acc.exists(existing => existing.by.is(comment.by) && existing.text == comment.text) then acc
        else acc :+ comment
      }
      def filterEmpty: Comments = a.value.filter(_.text.value.nonEmpty)
      def hasSiteComment = a.value.exists(_.by == Comment.Author.Site)
    val empty = Comments(Nil)

  type Gamebook = lila.xiangqi.XiangqiAnnotations.Gamebook
  val Gamebook = lila.xiangqi.XiangqiAnnotations.Gamebook

  import chess.json.Json.given
  given Writes[Node.Shapes] = Writes[Node.Shapes](s => Json.toJson(s.value))

  given Writes[Comment.Author] = Writes(author => Json.toJson(author.toAnnotation))
  given Writes[Node.Comment] = Json.writes[Node.Comment]

  import lila.tree.evals.jsonWrites

  given defaultNodeJsonWriter: Writes[Node] = Writes(writeJson(_))

  /** Iterative postorder serialization keeps the complete ordered tree safe at the depth limit. */
  def writeJson(
      root: Node,
      evaluation: Node => Option[JsObject] = node =>
        node.eval.filterNot(_.isEmpty).map(e => Json.toJson(e).as[JsObject])
  ): JsObject =
    val output = new java.util.IdentityHashMap[Node, JsObject]()
    val pending = scala.collection.mutable.ArrayDeque(root -> false)
    while pending.nonEmpty do
      val (node, visited) = pending.removeLast()
      if !visited then
        pending.append(node -> true)
        node.children.toList.reverseIterator.foreach(child => pending.append(child -> false))
      else
        import node.*
        val comments = node.comments.value
        val json = Json
          .obj("ply" -> ply, "fen" -> fen, "state" -> state)
          .add("id", idOption)
          .add("uci", moveOption.map(_.uci.value))
          .add("notation", moveOption.map(_.notation))
          .add("chineseNotation", moveOption.map(_.chineseNotation))
          .add(
            "ruleset",
            node match
              case root: Root => Some(root.ruleset)
              case _ => None
          )
          .add("eval", evaluation(node))
          .add("comments", if comments.nonEmpty then Some(comments) else None)
          .add("gamebook", gamebook)
          .add("glyphs", glyphs.nonEmpty)
          .add("shapes", if shapes.value.nonEmpty then Some(shapes.value) else None)
          .add("clock", clock.map(_.centis))
          .add("elapsed", elapsed)
          .add("evaluationDepth", evaluationDepth)
          .add("result", result)
          .add("comp", comp)
          .add("children", Some(JsArray(children.toList.map(output.get))))
          .add("forceVariation", forceVariation)
        output.put(node, json)
    output.get(root)
