package lila.msg

import lila.core.LightUser
import lila.core.relation.Relations
import lila.core.user.KidMode

case class MsgConvo(
    contact: LightUser,
    msgs: List[Msg],
    relations: Relations,
    postable: Boolean,
    contactDetailsForMods: Option[ContactDetailsForMods],
    pinned: List[Msg] = Nil
)

case class ModMsgConvo(
    contact: User,
    msgs: List[Msg],
    relations: Relations,
    truncated: Boolean
)

case class ContactDetailsForMods(kid: KidMode, openInbox: Boolean)
