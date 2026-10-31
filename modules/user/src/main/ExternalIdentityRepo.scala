package lila.user

import reactivemongo.api.indexes.{ Index, IndexType }
import lila.db.dsl.{ *, given }

/** Identities are embedded so registration and linking cannot leave orphaned credentials. */
final class ExternalIdentityRepo(users: UserRepo)(using Executor):
  import BSONHandlers.given
  private val field = "externalLogins"
  private lazy val indexed: Funit = users.coll.indexesManager
    .ensure(
      Index(
        Seq(field -> IndexType.Ascending),
        name = Some("externalLogins_unique"),
        unique = true,
        sparse = true
      )
    )
    .void

  def hasPassword(user: UserId): Fu[Boolean] =
    users.coll
      .primitiveOne[lila.core.security.HashedPassword]($id(user), "bpass")
      .map(_.exists(!_.isBlank))

  def ready: Funit = indexed
  def owner(key: String): Fu[Option[User]] = indexed >> users.coll.one[User]($doc(field -> key))
  def list(user: UserId): Fu[List[String]] =
    users.coll.primitiveOne[List[String]]($id(user), field).map(_.getOrElse(Nil))

  def link(user: UserId, key: String): Fu[Boolean] = indexed >> users.coll.update
    .one(
      $id(user) ++ $doc("enabled" -> true) ++ $doc(
        field -> $doc(
          "$not" ->
            $doc("$elemMatch" -> $doc("$regex" -> s"^${key.takeWhile(_ != ':')}:"))
        )
      ),
      $doc("$addToSet" -> $doc(field -> key))
    )
    .map(_.n == 1)
    .recover(lila.db.recoverDuplicateKey(_ => false))

  // The condition and removal are one write: concurrent unlinks cannot remove the last identity.
  def unlink(user: UserId, key: String): Fu[Boolean] =
    users.coll.update
      .one(
        $id(user) ++ $doc(field -> List(key), "enabled" -> true) ++
          $doc("bpass".$exists(true)) ++ $doc(
            "bpass".$ne(lila.core.security.HashedPassword(Array.emptyByteArray))
          ),
        $unset(field)
      )
      .flatMap: last =>
        if last.nModified == 1 then fuccess(true)
        else
          users.coll.update
            .one(
              $id(user) ++ $doc(field -> key, "enabled" -> true, s"$field.1".$exists(true)),
              $pull(field -> key)
            )
            .map(_.nModified == 1)
