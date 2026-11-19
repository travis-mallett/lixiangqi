package lila.push

import reactivemongo.api.bson.*
import scalalib.net.UserAgent

import lila.db.dsl.{ *, given }

final private class DeviceApi(coll: Coll)(using Executor):

  private given BSONDocumentHandler[Device] = Macros.handler

  private lazy val inboxSessionIndex: Funit =
    import reactivemongo.api.indexes.{ Index, IndexType }
    coll.indexesManager.ensure(Index(Seq("session" -> IndexType.Ascending), sparse = true)).void

  lila.common.Bus.sub[lila.core.user.UserDelete]: del =>
    coll.delete.one($doc("userId" -> del.id)).void

  lila.common.Bus.sub[lila.core.misc.oauth.TokenRevoke]: event =>
    inboxSessionIndex >> coll.delete
      .one($doc("platform" -> Device.inboxPlatform, "session" -> event.id.value))
      .void

  lila.common.Bus.sub[lila.core.user.SetKidMode]: event =>
    if event.user.kid.yes then
      coll.delete.one($doc("platform" -> Device.inboxPlatform, "userId" -> event.user.id)).void

  private[push] def findByDeviceId(deviceId: String): Fu[Option[Device]] =
    coll.find($id(deviceId)).one[Device]

  def firebaseDevices(userId: UserId): Fu[List[Device]] =
    coll
      .find(
        $doc(
          "userId" -> userId,
          "$or" -> List(
            $doc("platform" -> "firebase"),
            $doc("platform" -> Device.inboxPlatform, "seenAt".$gt(nowInstant.minusDays(30)))
          )
        )
      )
      .sort($doc("seenAt" -> -1))
      .cursor[Device]()
      .list(6)

  def registerInboxDevice(user: User, deviceId: String, session: String)(using UserAgent): Funit =
    val started = nowInstant
    inboxSessionIndex >> register(user, Device.inboxPlatform, deviceId, Some(session)) >>
      coll.delete
        .one(
          $doc(
            "platform" -> Device.inboxPlatform,
            "userId" -> user.id,
            "session" -> session,
            "_id".$ne(deviceId),
            "seenAt".$lt(started)
          )
        )
        .void

  def unregisterInboxDevice(user: User, session: String): Funit =
    coll.delete.one($doc("platform" -> Device.inboxPlatform, "userId" -> user.id, "session" -> session)).void

  def register(user: User, platform: String, deviceId: String, session: Option[String] = None)(using
      ua: UserAgent
  ) =
    lila.mon.push.register.in(platform).increment()
    coll.update
      .one(
        $id(deviceId),
        Device(
          _id = deviceId,
          platform = platform,
          userId = user.id,
          seenAt = nowInstant,
          ua = ua,
          session = session
        ),
        upsert = true
      )
      .void

  def unregister(user: User) =
    lila.mon.push.register.out.increment()
    coll.delete.one($doc("userId" -> user.id)).void

  def delete(device: Device) =
    coll.delete.one($id(device._id)).void
