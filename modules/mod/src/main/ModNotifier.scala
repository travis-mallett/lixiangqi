package lila.mod

import lila.core.notify.{ NotifyApi, NotificationContent }
import lila.report.Suspect

final private class ModNotifier(
    notifyApi: NotifyApi,
    reportApi: lila.report.ReportApi,
    pmPresets: ModPresetsApi,
    msgApi: lila.core.msg.MsgApi
)(using Executor):

  def reporters(mod: ModId, sus: Suspect): Funit =
    reportApi
      .recentReportersOf(sus)
      .flatMap:
        _.filterNot(_.is(mod))
          .parallelVoid: reporterId =>
            notifyApi.notifyOne(reporterId, NotificationContent.ReportedBanned)

  def rankRefund(user: User, points: Int): Funit =
    notifyApi.notifyOne(user, NotificationContent.RankRefund(points))

  def notifyKidMode(mod: ModId, user: User): Funit =
    pmPresets.setKidModePreset match
      case None => msgApi.systemPost(mod.userId, "No kid mode preset found, couldn't send a PM.").void
      case Some(preset) => msgApi.systemPost(user.id, preset.text).void
