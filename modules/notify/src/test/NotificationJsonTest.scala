package lila.notify

import play.api.libs.json.Json

import lila.core.notify.NotificationContent
import lila.core.userId.UserId

class NotificationJsonTest extends munit.FunSuite:
  test("notifications expose stable IDs for individual acknowledgements"):
    val handlers = new JSONHandlers(lila.core.LightUser.GetterSync(_ => None))
    import handlers.given
    val notice = Notification.make(UserId("alice"), NotificationContent.ReportedBanned)
    val json = Json.toJson(notice)
    assertEquals((json \ "id").as[String], notice.id.value)
    assertEquals((json \ "type").as[String], "reportedBanned")
    assertEquals((json \ "read").as[Boolean], false)
