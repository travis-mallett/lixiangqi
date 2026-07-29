package lila.pref

import play.api.libs.json.*

def toJson(p: Pref, lichobileCompat: Boolean) = Json.obj(
  "appearance" -> p.appearance,
  "autoQueen" -> p.autoQueen,
  "autoThreefold" -> p.autoThreefold,
  "takeback" -> p.takeback,
  "moretime" -> p.moretime,
  "clockTenths" -> p.clockTenths,
  "clockBar" -> p.clockBar,
  "clockSound" -> p.clockSound,
  "premove" -> p.premove,
  "animation" -> p.animation,
  "pieceNotation" -> p.pieceNotation,
  "captured" -> p.captured,
  "follow" -> p.follow,
  "highlight" -> p.highlight,
  "destination" -> p.destination,
  "coords" -> p.coords,
  "replay" -> p.replay,
  "challenge" -> p.challenge,
  "message" -> p.message,
  "submitMove" -> {
    if lichobileCompat then Pref.SubmitMove.lichobile.serverToApp(p.submitMove)
    else p.submitMove
  },
  "confirmResign" -> p.confirmResign,
  "insightShare" -> p.insightShare,
  "keyboardMove" -> p.keyboardMove,
  "voiceMove" -> p.hasVoice,
  "zen" -> p.zen,
  "ratings" -> p.ratings,
  "moveEvent" -> p.moveEvent,
  "rookCastle" -> p.rookCastle,
  "flairs" -> p.flairs,
  "sayGG" -> p.sayGG
)
