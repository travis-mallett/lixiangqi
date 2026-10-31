package lila.puzzle

import play.api.libs.json.*
import reactivemongo.api.bson.*

import lila.db.AsyncColl
import lila.db.dsl.{ *, given }

/** Catalog prices and eligibility are server owned. The same resource is bundled by the Kids app;
  * scripts/build_avatar_art.py --check verifies byte parity.
  */
object KidsAvatarCatalog:
  val json: JsObject =
    val stream = getClass.getResourceAsStream("/kids-avatar-catalog.json")
    require(stream != null, "Missing Kids avatar catalog")
    try Json.parse(stream).as[JsObject]
    finally stream.close()
  val version = (json \ "version").as[Int]
  val defaults = (json \ "defaults").as[Map[String, String]]
  val palettes = (json \ "palettes").as[Map[String, List[String]]]
  case class Item(id: String, category: String, unlock: Long, coins: Long, ingots: Long):
    def free = coins == 0 && ingots == 0
  val items: Map[String, Item] = (json \ "items")
    .as[List[JsObject]]
    .map { j =>
      val item = Item(
        (j \ "id").as[String],
        (j \ "category").as[String],
        (j \ "unlock").as[Long],
        (j \ "coins").as[Long],
        (j \ "ingots").as[Long]
      )
      require(item.coins >= 0 && item.ingots >= 0 && item.unlock >= 0)
      require(!item.free || item.unlock == 0, "Free identity choices cannot be progress gated")
      item.id -> item
    }
    .toMap
  val defaultAppearance: Map[String, String] = defaults ++ Map(
    "skinColor" -> palettes("skin")(1),
    "hairColor" -> palettes("hair").head,
    "eyeColor" -> palettes("eyes").head
  )

  // Existing accounts and released clients predate the independent smile slot.
  // Add only this new field; malformed identity, inventory or spending still fails.
  def addMissingSmile(
      value: Map[String, String],
      defaultSmile: String = defaults("smile")
  ): Map[String, String] =
    if value.contains("smile") then value else value.updated("smile", defaultSmile)

  def validAppearance(value: Map[String, String], owned: Set[String]): Boolean =
    value.keySet == defaultAppearance.keySet &&
      defaults.keys.forall { slot =>
        items.get(value(slot)).exists(i => i.category == slot && (i.free || owned(i.id)))
      } && List("skinColor" -> "skin", "hairColor" -> "hair", "eyeColor" -> "eyes").forall { (key, palette) =>
        palettes(palette).contains(value(key))
      }

/** All spending, grants and appearance updates use one account document. Earned balances still derive from
  * immutable reward receipts: no migration, duplicated crediting, or transaction between collections. CAS
  * prevents concurrent spending. Purchases are permanent and receipts are bounded by the finite catalog size.
  */
final class KidsAvatar(coll: AsyncColl, rewards: KidsRewards)(using Executor):
  import KidsAvatar.*

  private def read(id: UserId): Fu[State] =
    coll(_.byId[BSONDocument](id)).map(_.fold(State())(decode))

  private def ensure(id: UserId): Funit =
    coll(_.update.one($id(id), $doc("$setOnInsert" -> encode(State())), upsert = true)).void
      .recover(lila.db.ignoreDuplicateKey)

  def balance(id: UserId): Fu[JsObject] =
    for
      state <- read(id)
      earned <- rewards.earned(id)
    yield wallet(earned, state)

  def get(id: UserId): Fu[JsObject] =
    for
      state <- read(id)
      earned <- rewards.earned(id)
    yield response(earned, state)

  def equip(id: UserId, revision: Long, appearance: Map[String, String]): Fu[Either[String, JsObject]] =
    mutate(id): (_, state) =>
      val next = KidsAvatarCatalog.addMissingSmile(appearance, state.appearance("smile"))
      if !KidsAvatarCatalog.validAppearance(next, state.owned.toSet) then Left("invalid_appearance")
      else if state.appearance == next then Right(state)
      else if state.revision != revision then Left("conflict")
      else Right(state.copy(revision = state.revision + 1, appearance = next))

  def purchase(
      id: UserId,
      itemId: String,
      requestId: String,
      catalogVersion: Int
  ): Fu[Either[String, JsObject]] =
    if !requestId.matches("[A-Za-z0-9_-]{16,80}") then fuccess(Left("invalid_request"))
    else mutate(id) { (earned, state) => purchaseState(earned, state, itemId, requestId, catalogVersion) }

  private def mutate(id: UserId)(
      change: (Long, State) => Either[String, State]
  ): Fu[Either[String, JsObject]] =
    def attempt(left: Int): Fu[Either[String, JsObject]] =
      for
        state <- read(id)
        earned <- rewards.earned(id)
        result <- change(earned, state) match
          case Left(error) => fuccess(Left(error))
          case Right(next) if next == state => fuccess(Right(response(earned, state)))
          case Right(next) =>
            coll(
              _.findAndUpdateSimplified[BSONDocument](
                $id(id) ++ $doc("revision" -> state.revision),
                $doc("$set" -> encode(next)),
                fetchNewObject = true
              )
            ).flatMap:
              case Some(_) => fuccess(Right(response(earned, next)))
              case None if left > 0 => attempt(left - 1)
              case None => fuccess(Left("conflict"))
      yield result
    ensure(id).flatMap(_ => attempt(5))

object KidsAvatar:
  case class Receipt(item: String, request: String, coins: Long, ingots: Long)
  case class State(
      revision: Long = 0,
      spentCoins: Long = 0,
      spentIngots: Long = 0,
      owned: List[String] = Nil,
      appearance: Map[String, String] = KidsAvatarCatalog.defaultAppearance,
      receipts: List[Receipt] = Nil
  )

  private[puzzle] def purchaseState(
      earned: Long,
      state: State,
      itemId: String,
      requestId: String,
      catalogVersion: Int
  ): Either[String, State] =
    state.receipts.find(_.request == requestId) match
      case Some(receipt) => Either.cond(receipt.item == itemId, state, "request_reused")
      case None =>
        KidsAvatarCatalog.items.get(itemId) match
          case None => Left("unknown_item")
          case Some(item) if state.owned.contains(item.id) || item.free => Right(state)
          case Some(_) if catalogVersion != KidsAvatarCatalog.version => Left("catalog_changed")
          case Some(item) if earned < item.unlock => Left("locked")
          case Some(item)
              if earned - state.spentCoins < item.coins ||
                KidsRewards.ingots(earned) - state.spentIngots < item.ingots =>
            Left("insufficient_funds")
          case Some(item) =>
            Right(
              state.copy(
                revision = state.revision + 1,
                spentCoins = state.spentCoins + item.coins,
                spentIngots = state.spentIngots + item.ingots,
                owned = item.id :: state.owned,
                appearance = state.appearance.updated(item.category, item.id),
                receipts = Receipt(item.id, requestId, item.coins, item.ingots) :: state.receipts
              )
            )

  private[puzzle] def wallet(earned: Long, state: State): JsObject = Json.obj(
    "earnedCoins" -> earned,
    "coins" -> (earned - state.spentCoins),
    "ingots" -> (KidsRewards.ingots(earned) - state.spentIngots),
    "spentCoins" -> state.spentCoins,
    "spentIngots" -> state.spentIngots,
    "walletRevision" -> state.revision
  )

  private def response(earned: Long, state: State): JsObject = Json.obj(
    "catalogVersion" -> KidsAvatarCatalog.version,
    "revision" -> state.revision,
    "owned" -> state.owned,
    "appearance" -> state.appearance,
    "rewards" -> wallet(earned, state)
  )

  private def encode(state: State): BSONDocument = $doc(
    "revision" -> state.revision,
    "spentCoins" -> state.spentCoins,
    "spentIngots" -> state.spentIngots,
    "owned" -> state.owned,
    "appearance" -> state.appearance,
    "receipts" -> state.receipts.map(r =>
      $doc(
        "item" -> r.item,
        "request" -> r.request,
        "coins" -> r.coins,
        "ingots" -> r.ingots
      )
    )
  )

  private def decode(doc: BSONDocument): State = State(
    // Existing documents must be complete; corrupt spending or receipts must
    // fail the request rather than silently restoring spendable currency.
    revision = doc.getAsTry[Long]("revision").get,
    spentCoins = doc.getAsTry[Long]("spentCoins").get,
    spentIngots = doc.getAsTry[Long]("spentIngots").get,
    owned = doc.getAsTry[List[String]]("owned").get,
    appearance = KidsAvatarCatalog.addMissingSmile(doc.getAsTry[Map[String, String]]("appearance").get),
    receipts = doc
      .getAsTry[List[BSONDocument]]("receipts")
      .get
      .map(d =>
        Receipt(
          d.getAsTry[String]("item").get,
          d.getAsTry[String]("request").get,
          d.getAsTry[Long]("coins").get,
          d.getAsTry[Long]("ingots").get
        )
      )
  )
