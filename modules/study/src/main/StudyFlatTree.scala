package lila.study

import lila.xiangqi.{ Xiangqi, UciPath }
import lila.mon.Chronometer.syncMon
import lila.db.dsl.*
import lila.tree.{ Branch, Branches, Root }
import BSONHandlers.{ readBranch, writeBranch }
import BSONHandlers.given

private object StudyFlatTree:
  object reader:
    def rootChildren(flatTree: Bdoc, game: Xiangqi.Game): Branches =
      syncMon(lila.mon.study.tree.read):
        val entries = flatTree.elements.toList.collect:
          case el if el.name != UciPathDb.rootDbKey =>
            UciPathDb.decodeDbKey(el.name) -> el.value
              .asOpt[Bdoc]
              .getOrElse(throw IllegalArgumentException(s"Invalid study node ${el.name}"))
        require(entries.size <= Chapter.maxNodes, "Study has too many nodes")
        val byParent = entries.groupBy(_._1.parent)
        var visited = 0
        def children(parent: UciPath, history: Xiangqi.Game): Branches =
          val parentDoc =
            flatTree.getAsTry[Bdoc](if parent.isEmpty then UciPathDb.rootDbKey else parent.value).get
          val order = parentDoc.getAsTry[List[Xiangqi.Uci]](Node.BsonFields.order).get
          val siblings = byParent.getOrElse(parent, Nil)
          require(
            order.distinct.size == order.size && order.toSet == siblings.flatMap(_._1.lastId).toSet,
            s"Invalid child order at ${parent.value}"
          )
          val indexed = siblings.map((path, doc) => path.lastId.get -> (path, doc)).toMap
          Branches(order.map(indexed).map { (path, doc) =>
            val (branch, next) = readBranch(doc, history)
            require(path.lastId.contains(branch.id), s"Study path/move mismatch: ${path.value}")
            visited += 1
            branch.copy(children = children(path, next))
          })
        val result = children(UciPath.root, game)
        require(visited == entries.size, "Study contains orphaned nodes")
        result

  object writer:
    def rootChildren(root: Root): List[(String, Bdoc)] =
      syncMon(lila.mon.study.tree.write):
        require(root.children.countRecursive <= Chapter.maxNodes, "Study has too many nodes")
        root.children.toList.flatMap(traverse(_, UciPath.root))

    private def traverse(node: Branch, parentPath: UciPath): List[(String, Bdoc)] =
      require(parentPath.depth < Node.MAX_PLIES, "Study exceeds maximum path depth")
      val path = parentPath + node.id
      (UciPathDb.encodeDbKey(path) -> writeBranch(node)) ::
        node.children.toList.flatMap(traverse(_, path))
