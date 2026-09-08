package lila.mod

object AutoAnalysis:

  enum Reason:
    case Upset
    case HoldAlert
    case WhiteMoveTime
    case BlackMoveTime
    case Blurs
    case NewPlayerWin
    case TitledPlayer
