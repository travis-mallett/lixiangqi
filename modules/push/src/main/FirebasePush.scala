package lila.push

import com.google.auth.oauth2.{ AccessToken, GoogleCredentials, ServiceAccountCredentials }
import play.api.ConfigLoader
import play.api.libs.json.*
import play.api.libs.ws.JsonBodyWritables.*
import play.api.libs.ws.StandaloneWSClient
import scalalib.cache.FrequencyThreshold
import scalalib.data.LazyFu

import lila.mon.extensions.*

final private class FirebasePush(
    unifiedPush: UnifiedWebPush,
    deviceApi: DeviceApi,
    ws: StandaloneWSClient,
    configs: FirebasePush.BothConfigs
)(using Executor, Scheduler):

  if configs.lichobile.googleCredentials.isDefined then
    logger.info("Lichobile Firebase push notifications are enabled.")
  if configs.mobile.googleCredentials.isDefined then
    logger.info("Mobile Firebase push notifications are enabled.")

  private val workQueue =
    scalalib.actor.AsyncActorSequencer(
      maxSize = Max(512),
      timeout = 10.seconds,
      name = "firebasePush",
      lila.mon.asyncActorMonitor.full
    )

  def apply(userId: UserId, data: LazyFu[PushApi.Data]): Funit =
    unifiedPush(userId, data)
    deviceApi
      .firebaseDevices(userId)
      .flatMap:
        _.sequentiallyVoid: device =>
          val configOpt =
            if device.isInbox then Option.when(configs.inbox.url.nonEmpty)(configs.inbox)
            else if device.isMobile then configs.mobile.some
            else if device.isLichobile then configs.lichobile.some
            else None
          configOpt match
            case None =>
              logger.info("Unsupported Firebase device")
              // deviceApi.delete(device) // cleanup unsupported device?
              funit
            case Some(config) =>
              config.googleCredentials.so: creds =>
                for
                  data <- data.value
                  compatible =
                    if device.isInbox then data.key == Key.privateMessage
                    else
                      data.mobileCompatible.exists(
                        device.isMobileVersionCompatible
                      ) || data.lichobileCompatible && device.isLichobile
                  _ <- compatible.so:
                    for
                      // access token has 1h lifetime and is requested only if expired
                      token <- workQueue {
                        Future:
                          lila.mon.Chronometer.syncMon(lila.mon.blocking.time("firebase")):
                            creds.refreshIfExpired()
                            creds.getAccessToken()
                      }.chronometer.mon(lila.mon.push.googleTokenTime).result
                      _ <- send(token, device, config, data)
                    yield ()
                yield ()

  opaque type StatusCode = Int
  object StatusCode extends OpaqueInt[StatusCode]
  private val errorCounter = FrequencyThreshold[StatusCode](50, 10.minutes)

  private def send(
      token: AccessToken,
      device: Device,
      config: FirebasePush.Config,
      data: PushApi.Data
  ): Funit =
    ws.url(config.url)
      .withHttpHeaders(
        "Authorization" -> s"Bearer ${token.getTokenValue}",
        "Accept" -> "application/json",
        "Content-type" -> "application/json; UTF-8"
      )
      .post:
        Json.obj(
          "message" ->
            FirebasePush
              .makeMobilePayload(data, inbox = device.isInbox)
              .add:
                (if device.isInbox then "fid" else "token") -> device._id.some
              .add:
                "android" -> Json.obj("priority" -> "high").some
              .add:
                "apns" -> data.iosBadge.map: number =>
                  Json.obj(
                    "headers" -> Json.obj("apns-priority" -> "10"),
                    "payload" -> Json.obj:
                      "aps" -> Json.obj("badge" -> number)
                  )
        )
      .flatMap: res =>
        val project =
          if device.isInbox then "lixiangqiInbox" else if device.isMobile then "mobileV2" else "lichobile"
        val dataType = data.firebaseMod.fold("both"):
          case PushApi.Data.FirebaseMod.DataOnly => "data"
          case PushApi.Data.FirebaseMod.NotifOnly(_) => "notif"
        lila.mon.push.firebaseStatus(project, dataType, res.status).increment()
        if res.status == 200 then funit
        else if res.status == 404 then
          logger.info("Deleting an unregistered Firebase device")
          deviceApi.delete(device)
        else
          if errorCounter(res.status) then logger.warn(s"[push] firebase: ${res.status}")
          funit

private object FirebasePush:

  final class Config(val url: String, val json: lila.core.config.Secret, val jsonPath: String):
    lazy val googleCredentials: Option[GoogleCredentials] =
      try
        val jsonStr =
          if jsonPath.nonEmpty then scala.io.Source.fromFile(jsonPath).mkString
          else json.value
        jsonStr.nonEmptyOption.map: json =>
          import java.nio.charset.StandardCharsets.UTF_8
          import scala.jdk.CollectionConverters.*
          ServiceAccountCredentials
            .fromStream(new java.io.ByteArrayInputStream(json.getBytes(UTF_8)))
            .createScoped(Set("https://www.googleapis.com/auth/firebase.messaging").asJava)
      catch
        case e: Exception =>
          logger.warn("Failed to create google credentials", e)
          none
  final class BothConfigs(val lichobile: Config, val mobile: Config, val inbox: Config)
  import lila.common.autoconfig.*
  import lila.common.config.given
  given ConfigLoader[Config] = AutoConfig.loader[Config]
  given ConfigLoader[BothConfigs] = AutoConfig.loader[BothConfigs]

  def makeMobilePayload(data: PushApi.Data, inbox: Boolean = false): JsObject =
    Json
      .obj(
        "data" -> toDataKeyValue:
          data.firebaseMod.match
            case Some(PushApi.Data.FirebaseMod.NotifOnly(mod)) => mod(data.payload.userData)
            case _ =>
              data.payload.userData ++ Option
                .when(inbox)(data.payload.userId)
                .flatten
                .map(u => "account" -> u.value) ++ (data.iosBadge.map: number =>
                "iosBadge" -> number.toString)
      )
      .add:
        "notification" -> data.firebaseMod.match
          case Some(PushApi.Data.FirebaseMod.DataOnly) => none
          case _ => Json.obj("body" -> data.body, "title" -> data.title).some

  private def toDataKeyValue(data: PushApi.Data.KeyValue): JsObject = JsObject:
    data.view
      .map: (k, v) =>
        s"lichess.$k" -> JsString(v)
      .toMap
