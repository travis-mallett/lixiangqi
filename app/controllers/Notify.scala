package controllers

import lila.app.*

final class Notify(env: Env) extends LilaController(env):

  def mobile(page: Int) = AuthOrScoped(_.Mobile.Notifications) { _ ?=> me ?=>
    Reasonable(page, Max(100), notFound):
      for
        notifications <- env.notifyM.api.getNotificationsAndCount(me, page)
        counts <- env.notifyM.api.unreadByType(me)
      yield JsonOk(
        env.notifyM.jsonHandlers(notifications) ++ play.api.libs.json.Json.obj("unreadByType" -> counts)
      )
  }

  def readMobile(id: String) = AuthOrScoped(_.Mobile.Notifications) { _ ?=> me ?=>
    env.notifyM.api.readNotification(me, id).inject(NoContent)
  }

  def recent(page: Int) = Auth { _ ?=> me ?=>
    XhrOrRedirectHome:
      env.notifyM.api
        .getNotificationsAndCount(me, page)
        .map(env.notifyM.jsonHandlers.apply)
        .map(JsonOk)
  }

  def clear = Auth { _ ?=> me ?=>
    env.notifyM.api.remove(me).inject(NoContent)
  }
