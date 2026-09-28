package lila.puzzle

import lila.core.i18n.I18nKey
import lila.core.i18n.I18nKey.puzzleTheme as i

case class PuzzleTheme(key: PuzzleTheme.Key, name: I18nKey, description: I18nKey):
  def iconFile: String =
    if key.value.startsWith("mateIn") then "mate.svg"
    else
      key.value match
        case "doubleChariotsMate" | "throatCuttingMate" | "smallThroatCuttingMate" |
            "doubleChariotsThreateningAdvisor" | "moonScoopingMate" | "singleHorseCapturesKing" |
            "elbowHorse" | "palcornerHorse" | "anglerHorse" | "highAnglerHorse" | "octagonalHorse" |
            "springHorseMate" | "doubleHorsesMate" | "doubleCannons" | "heavenAndEarthCannons" |
            "smotheredCannon" | "ironBolt" | "horseCannonMate" | "cannonsSandwichingChariot" |
            "crowningMate" | "doubleToastMate" | "doubleGhostsKnocking" | "threeChariotsHarassingAdvisor" |
            "centroidPawnMate" | "repatriationOfBuddha" | "whiteFacedGeneral" | "winningMaterialByTrapping" |
            "winningMaterialByRestraint" | "winningMaterialBySkewer" | "winningMaterialByDoubleAttack" |
            "exchangingToWinMaterial" | "exchangingToSeizeInitiative" | "exchangingToRelievePressure" |
            "chariotMatingMethods" | "horseMatingMethods" | "cannonMatingMethods" | "soldierMatingMethods" |
            "chariotHorseMatingMethods" | "chariotCannonMatingMethods" | "chariotSoldierMatingMethods" |
            "horseCannonMatingMethods" | "horseSoldierMatingMethods" | "cannonSoldierMatingMethods" |
            "chariotHorseCannonMatingMethods" | "chariotHorseSoldierMatingMethods" |
            "chariotCannonSoldierMatingMethods" | "horseCannonSoldierMatingMethods" |
            "chariotHorseCannonSoldierMatingMethods" | "bachelorChariotAttack" | "boldChariotAttack" |
            "pawnTripleAdvancementAttack" | "eunuchChasingEmperorKill" | "chariotPawnZugzwang" |
            "oldPawnSearchingMountain" | "threeImmortalsRefiningTheElixir" | "whiteHorseMate" |
            "chariotHorseZugzwang" | "cannonChariotDiscoveredAttack" | "detonatingMineAttack" |
            "headhunterCannonAttack" | "childWorshipsBuddha" | "servantCrowdingMasterAttack" |
            "stalemateMate" | "leisurelyStrollMate" | "flankingTrioMate" | "drawerMate" | "doubleCheckMate" |
            "tripleCheckMate" | "quadrupleCheckMate" | "crossCheckAttack" | "hidingBehindLeavesAttack" |
            "generalDisrobingAttack" | "assistingKingAttack" | "threeChariotAttack" | "smallIronBolt" =>
          s"${key.value}.webp"
        case _ => "mix.svg"

object PuzzleTheme:

  private def apply(name: I18nKey, desc: I18nKey): PuzzleTheme =
    PuzzleTheme(Key(name.value.split(":", 2).lift(1).getOrElse(name.value)), name, desc)

  opaque type Key = String
  object Key extends OpaqueString[Key]

  case class WithCount(theme: PuzzleTheme, count: Int)

  enum VoteError:
    case Unchanged
    case Fail(msg: String) extends VoteError
    def message: String = this match
      case Fail(msg) => msg
      case Unchanged => "unchanged"

  val mix = PuzzleTheme(i.mix, i.mixDescription)
  val advancedPawn = PuzzleTheme(i.advancedPawn, i.advancedPawnDescription)
  val advantage = PuzzleTheme(i.advantage, i.advantageDescription)
  val anastasiaMate = PuzzleTheme(i.anastasiaMate, i.anastasiaMateDescription)
  val arabianMate = PuzzleTheme(i.arabianMate, i.arabianMateDescription)
  val attackingF2F7 = PuzzleTheme(i.attackingF2F7, i.attackingF2F7Description)
  val attraction = PuzzleTheme(i.attraction, i.attractionDescription)
  val backRankMate = PuzzleTheme(i.backRankMate, i.backRankMateDescription)
  val balestraMate = PuzzleTheme(i.balestraMate, i.balestraMateDescription)
  val blindSwineMate = PuzzleTheme(i.blindSwineMate, i.blindSwineMateDescription)
  val triangleMate = PuzzleTheme(i.triangleMate, i.triangleMateDescription)
  val bishopEndgame = PuzzleTheme(i.bishopEndgame, i.bishopEndgameDescription)
  val bodenMate = PuzzleTheme(i.bodenMate, i.bodenMateDescription)
  val capturingDefender =
    PuzzleTheme(i.capturingDefender, i.capturingDefenderDescription)
  val collinearMove = PuzzleTheme(i.collinearMove, i.collinearMoveDescription)
  val castling = PuzzleTheme(i.castling, i.castlingDescription)
  val clearance = PuzzleTheme(i.clearance, i.clearanceDescription)
  val cornerMate = PuzzleTheme(i.cornerMate, i.cornerMateDescription)
  val crushing = PuzzleTheme(i.crushing, i.crushingDescription)
  val defensiveMove = PuzzleTheme(i.defensiveMove, i.defensiveMoveDescription)
  val deflection = PuzzleTheme(i.deflection, i.deflectionDescription)
  val discoveredAttack =
    PuzzleTheme(i.discoveredAttack, i.discoveredAttackDescription)
  val discoveredCheck = PuzzleTheme(i.discoveredCheck, i.discoveredCheckDescription)
  val doubleBishopMate =
    PuzzleTheme(i.doubleBishopMate, i.doubleBishopMateDescription)
  val doubleCheck = PuzzleTheme(i.doubleCheck, i.doubleCheckDescription)
  val dovetailMate =
    PuzzleTheme(i.dovetailMate, i.dovetailMateDescription)
  val equality = PuzzleTheme(i.equality, i.equalityDescription)
  val endgame = PuzzleTheme(i.endgame, i.endgameDescription)
  val epauletteMate = PuzzleTheme(i.epauletteMate, i.epauletteMateDescription)
  val enPassant = PuzzleTheme(I18nKey.site.enPassant, i.enPassantDescription)
  val exposedKing = PuzzleTheme(i.exposedKing, i.exposedKingDescription)
  val fork = PuzzleTheme(i.fork, i.forkDescription)
  val hangingPiece = PuzzleTheme(i.hangingPiece, i.hangingPieceDescription)
  val hookMate = PuzzleTheme(i.hookMate, i.hookMateDescription)
  val interference = PuzzleTheme(i.interference, i.interferenceDescription)
  val intermezzo = PuzzleTheme(i.intermezzo, i.intermezzoDescription)
  val kingsideAttack = PuzzleTheme(i.kingsideAttack, i.kingsideAttackDescription)
  val killBoxMate = PuzzleTheme(i.killBoxMate, i.killBoxMateDescription)
  val pillsburysMate = PuzzleTheme(i.pillsburysMate, i.pillsburysMateDescription)
  val morphysMate = PuzzleTheme(i.morphysMate, i.morphysMateDescription)
  val vukovicMate = PuzzleTheme(i.vukovicMate, i.vukovicMateDescription)
  val knightEndgame = PuzzleTheme(i.knightEndgame, i.knightEndgameDescription)
  val long = PuzzleTheme(i.long, i.longDescription)
  val master = PuzzleTheme(i.master, i.masterDescription)
  val masterVsMaster = PuzzleTheme(i.masterVsMaster, i.masterVsMasterDescription)
  val mate = PuzzleTheme(i.mate, i.mateDescription)
  val mateIn1 = PuzzleTheme(i.mateIn1, i.mateIn1Description)
  val mateIn2 = PuzzleTheme(i.mateIn2, i.mateIn2Description)
  val mateIn3 = PuzzleTheme(i.mateIn3, i.mateIn3Description)
  val mateIn4 = PuzzleTheme(i.mateIn4, i.mateIn4Description)
  val mateIn5 = PuzzleTheme(i.mateIn5, i.mateIn5Description)
  val mateIn6 = PuzzleTheme(i.mateIn6, i.mateIn6Description)
  val mateIn7 = PuzzleTheme(i.mateIn7, i.mateIn7Description)
  val mateIn8 = PuzzleTheme(i.mateIn8, i.mateIn8Description)
  val smotheredMate = PuzzleTheme(i.smotheredMate, i.smotheredMateDescription)
  val oneMove = PuzzleTheme(i.oneMove, i.oneMoveDescription)
  val operaMate = PuzzleTheme(i.operaMate, i.operaMateDescription)
  val pawnEndgame = PuzzleTheme(i.pawnEndgame, i.pawnEndgameDescription)
  val pin = PuzzleTheme(i.pin, i.pinDescription)
  val promotion = PuzzleTheme(i.promotion, i.promotionDescription)
  val queenEndgame = PuzzleTheme(i.queenEndgame, i.queenEndgameDescription)
  val queenRookEndgame =
    PuzzleTheme(i.queenRookEndgame, i.queenRookEndgameDescription)
  val queensideAttack = PuzzleTheme(i.queensideAttack, i.queensideAttackDescription)
  val quietMove = PuzzleTheme(i.quietMove, i.quietMoveDescription)
  val rookEndgame = PuzzleTheme(i.rookEndgame, i.rookEndgameDescription)
  val sacrifice = PuzzleTheme(i.sacrifice, i.sacrificeDescription)
  val short = PuzzleTheme(i.short, i.shortDescription)
  val skewer = PuzzleTheme(i.skewer, i.skewerDescription)
  val superGM = PuzzleTheme(i.superGM, i.superGMDescription)
  val swallowstailMate = PuzzleTheme(i.swallowstailMate, i.swallowstailMateDescription)
  val trappedPiece = PuzzleTheme(i.trappedPiece, i.trappedPieceDescription)
  val underPromotion = PuzzleTheme(i.underPromotion, i.underPromotionDescription)
  val veryLong = PuzzleTheme(i.veryLong, i.veryLongDescription)
  val xRayAttack = PuzzleTheme(i.xRayAttack, i.xRayAttackDescription)
  val zugzwang = PuzzleTheme(i.zugzwang, i.zugzwangDescription)
  val centroidPawnMate = PuzzleTheme(i.centroidPawnMate, i.centroidPawnMateDescription)
  val octagonalHorse = PuzzleTheme(i.octagonalHorse, i.octagonalHorseDescription)
  val doubleCannons = PuzzleTheme(i.doubleCannons, i.doubleCannonsDescription)
  val whiteFacedGeneral = PuzzleTheme(i.whiteFacedGeneral, i.whiteFacedGeneralDescription)
  val checkFirst = PuzzleTheme(Key("checkFirst"), I18nKey("Check first"), I18nKey("Check first"))

  val doubleChariotsMate = PuzzleTheme(i.doubleChariotsMate, i.doubleChariotsMateDescription)
  val throatCuttingMate = PuzzleTheme(i.throatCuttingMate, i.throatCuttingMateDescription)
  val smallThroatCuttingMate = PuzzleTheme(i.smallThroatCuttingMate, i.smallThroatCuttingMateDescription)
  val doubleChariotsThreateningAdvisor =
    PuzzleTheme(i.doubleChariotsThreateningAdvisor, i.doubleChariotsThreateningAdvisorDescription)
  val moonScoopingMate = PuzzleTheme(i.moonScoopingMate, i.moonScoopingMateDescription)
  val singleHorseCapturesKing = PuzzleTheme(i.singleHorseCapturesKing, i.singleHorseCapturesKingDescription)
  val elbowHorse = PuzzleTheme(i.elbowHorse, i.elbowHorseDescription)
  val palcornerHorse = PuzzleTheme(i.palcornerHorse, i.palcornerHorseDescription)
  val anglerHorse = PuzzleTheme(i.anglerHorse, i.anglerHorseDescription)
  val highAnglerHorse = PuzzleTheme(i.highAnglerHorse, i.highAnglerHorseDescription)
  val springHorseMate = PuzzleTheme(i.springHorseMate, i.springHorseMateDescription)
  val doubleHorsesMate = PuzzleTheme(i.doubleHorsesMate, i.doubleHorsesMateDescription)
  val heavenAndEarthCannons = PuzzleTheme(i.heavenAndEarthCannons, i.heavenAndEarthCannonsDescription)
  val smotheredCannon = PuzzleTheme(i.smotheredCannon, i.smotheredCannonDescription)
  val ironBolt = PuzzleTheme(i.ironBolt, i.ironBoltDescription)
  val horseCannonMate = PuzzleTheme(i.horseCannonMate, i.horseCannonMateDescription)
  val cannonsSandwichingChariot =
    PuzzleTheme(i.cannonsSandwichingChariot, i.cannonsSandwichingChariotDescription)
  val crowningMate = PuzzleTheme(i.crowningMate, i.crowningMateDescription)
  val doubleToastMate = PuzzleTheme(i.doubleToastMate, i.doubleToastMateDescription)
  val doubleGhostsKnocking = PuzzleTheme(i.doubleGhostsKnocking, i.doubleGhostsKnockingDescription)
  val threeChariotsHarassingAdvisor =
    PuzzleTheme(i.threeChariotsHarassingAdvisor, i.threeChariotsHarassingAdvisorDescription)
  val repatriationOfBuddha = PuzzleTheme(i.repatriationOfBuddha, i.repatriationOfBuddhaDescription)
  val winningMaterialByTrapping =
    PuzzleTheme(i.winningMaterialByTrapping, i.winningMaterialByTrappingDescription)
  val winningMaterialByRestraint =
    PuzzleTheme(i.winningMaterialByRestraint, i.winningMaterialByRestraintDescription)
  val winningMaterialBySkewer = PuzzleTheme(i.winningMaterialBySkewer, i.winningMaterialBySkewerDescription)
  val winningMaterialByDoubleAttack =
    PuzzleTheme(i.winningMaterialByDoubleAttack, i.winningMaterialByDoubleAttackDescription)
  val exchangingToWinMaterial = PuzzleTheme(i.exchangingToWinMaterial, i.exchangingToWinMaterialDescription)
  val exchangingToSeizeInitiative =
    PuzzleTheme(i.exchangingToSeizeInitiative, i.exchangingToSeizeInitiativeDescription)
  val exchangingToRelievePressure =
    PuzzleTheme(i.exchangingToRelievePressure, i.exchangingToRelievePressureDescription)

  val chariotMatingMethods = PuzzleTheme(i.chariotMatingMethods, i.chariotMatingMethodsDescription)
  val horseMatingMethods = PuzzleTheme(i.horseMatingMethods, i.horseMatingMethodsDescription)
  val cannonMatingMethods = PuzzleTheme(i.cannonMatingMethods, i.cannonMatingMethodsDescription)
  val soldierMatingMethods = PuzzleTheme(i.soldierMatingMethods, i.soldierMatingMethodsDescription)
  val chariotHorseMatingMethods =
    PuzzleTheme(i.chariotHorseMatingMethods, i.chariotHorseMatingMethodsDescription)
  val chariotCannonMatingMethods =
    PuzzleTheme(i.chariotCannonMatingMethods, i.chariotCannonMatingMethodsDescription)
  val chariotSoldierMatingMethods =
    PuzzleTheme(i.chariotSoldierMatingMethods, i.chariotSoldierMatingMethodsDescription)
  val horseCannonMatingMethods =
    PuzzleTheme(i.horseCannonMatingMethods, i.horseCannonMatingMethodsDescription)
  val horseSoldierMatingMethods =
    PuzzleTheme(i.horseSoldierMatingMethods, i.horseSoldierMatingMethodsDescription)
  val cannonSoldierMatingMethods =
    PuzzleTheme(i.cannonSoldierMatingMethods, i.cannonSoldierMatingMethodsDescription)
  val chariotHorseCannonMatingMethods =
    PuzzleTheme(i.chariotHorseCannonMatingMethods, i.chariotHorseCannonMatingMethodsDescription)
  val chariotHorseSoldierMatingMethods =
    PuzzleTheme(i.chariotHorseSoldierMatingMethods, i.chariotHorseSoldierMatingMethodsDescription)
  val chariotCannonSoldierMatingMethods =
    PuzzleTheme(i.chariotCannonSoldierMatingMethods, i.chariotCannonSoldierMatingMethodsDescription)
  val horseCannonSoldierMatingMethods =
    PuzzleTheme(i.horseCannonSoldierMatingMethods, i.horseCannonSoldierMatingMethodsDescription)
  val chariotHorseCannonSoldierMatingMethods =
    PuzzleTheme(i.chariotHorseCannonSoldierMatingMethods, i.chariotHorseCannonSoldierMatingMethodsDescription)

  val threeChariotAttack = PuzzleTheme(i.threeChariotAttack, i.threeChariotAttackDescription)
  val smallIronBolt = PuzzleTheme(i.smallIronBolt, i.smallIronBoltDescription)
  val bachelorChariotAttack = PuzzleTheme(i.bachelorChariotAttack, i.bachelorChariotAttackDescription)
  val boldChariotAttack = PuzzleTheme(i.boldChariotAttack, i.boldChariotAttackDescription)
  val pawnTripleAdvancementAttack =
    PuzzleTheme(i.pawnTripleAdvancementAttack, i.pawnTripleAdvancementAttackDescription)
  val eunuchChasingEmperorKill =
    PuzzleTheme(i.eunuchChasingEmperorKill, i.eunuchChasingEmperorKillDescription)
  val chariotPawnZugzwang = PuzzleTheme(i.chariotPawnZugzwang, i.chariotPawnZugzwangDescription)
  val oldPawnSearchingMountain =
    PuzzleTheme(i.oldPawnSearchingMountain, i.oldPawnSearchingMountainDescription)
  val threeImmortalsRefiningTheElixir =
    PuzzleTheme(i.threeImmortalsRefiningTheElixir, i.threeImmortalsRefiningTheElixirDescription)
  val whiteHorseMate = PuzzleTheme(i.whiteHorseMate, i.whiteHorseMateDescription)
  val chariotHorseZugzwang = PuzzleTheme(i.chariotHorseZugzwang, i.chariotHorseZugzwangDescription)
  val cannonChariotDiscoveredAttack =
    PuzzleTheme(i.cannonChariotDiscoveredAttack, i.cannonChariotDiscoveredAttackDescription)
  val detonatingMineAttack = PuzzleTheme(i.detonatingMineAttack, i.detonatingMineAttackDescription)
  val headhunterCannonAttack = PuzzleTheme(i.headhunterCannonAttack, i.headhunterCannonAttackDescription)
  val childWorshipsBuddha = PuzzleTheme(i.childWorshipsBuddha, i.childWorshipsBuddhaDescription)
  val servantCrowdingMasterAttack =
    PuzzleTheme(i.servantCrowdingMasterAttack, i.servantCrowdingMasterAttackDescription)
  val stalemateMate = PuzzleTheme(i.stalemateMate, i.stalemateMateDescription)
  val leisurelyStrollMate = PuzzleTheme(i.leisurelyStrollMate, i.leisurelyStrollMateDescription)
  val flankingTrioMate = PuzzleTheme(i.flankingTrioMate, i.flankingTrioMateDescription)
  val drawerMate = PuzzleTheme(i.drawerMate, i.drawerMateDescription)
  val doubleCheckMate = PuzzleTheme(i.doubleCheckMate, i.doubleCheckMateDescription)
  val tripleCheckMate = PuzzleTheme(i.tripleCheckMate, i.tripleCheckMateDescription)
  val quadrupleCheckMate = PuzzleTheme(i.quadrupleCheckMate, i.quadrupleCheckMateDescription)
  val crossCheckAttack = PuzzleTheme(i.crossCheckAttack, i.crossCheckAttackDescription)
  val hidingBehindLeavesAttack =
    PuzzleTheme(i.hidingBehindLeavesAttack, i.hidingBehindLeavesAttackDescription)
  val generalDisrobingAttack = PuzzleTheme(i.generalDisrobingAttack, i.generalDisrobingAttackDescription)
  val assistingKingAttack = PuzzleTheme(i.assistingKingAttack, i.assistingKingAttackDescription)

  val otherNamedBasicKills: List[PuzzleTheme] = List(
    threeChariotAttack,
    bachelorChariotAttack,
    boldChariotAttack,
    smallThroatCuttingMate,
    pawnTripleAdvancementAttack,
    eunuchChasingEmperorKill,
    chariotPawnZugzwang,
    oldPawnSearchingMountain,
    threeImmortalsRefiningTheElixir,
    whiteHorseMate,
    chariotHorseZugzwang,
    smallIronBolt,
    cannonChariotDiscoveredAttack,
    detonatingMineAttack,
    headhunterCannonAttack,
    childWorshipsBuddha,
    servantCrowdingMasterAttack,
    stalemateMate,
    leisurelyStrollMate,
    flankingTrioMate,
    drawerMate,
    doubleCheckMate,
    tripleCheckMate,
    quadrupleCheckMate,
    crossCheckAttack,
    hidingBehindLeavesAttack,
    generalDisrobingAttack,
    assistingKingAttack
  )

  val pieceTypeMates: List[PuzzleTheme] = List(
    chariotMatingMethods,
    horseMatingMethods,
    cannonMatingMethods,
    soldierMatingMethods,
    chariotHorseMatingMethods,
    chariotCannonMatingMethods,
    chariotSoldierMatingMethods,
    horseCannonMatingMethods,
    horseSoldierMatingMethods,
    cannonSoldierMatingMethods,
    chariotHorseCannonMatingMethods,
    chariotHorseSoldierMatingMethods,
    chariotCannonSoldierMatingMethods,
    horseCannonSoldierMatingMethods,
    chariotHorseCannonSoldierMatingMethods
  )

  case class Category[A](name: I18nKey, themes: List[A])
  case class Section[A](name: I18nKey, categories: List[Category[A]])

  val categorized: List[Section[PuzzleTheme]] = List(
    Section(
      i.basicKills,
      List(
        Category(
          i.chariotKillingMethods,
          List(
            doubleChariotsMate,
            throatCuttingMate,
            doubleChariotsThreateningAdvisor,
            moonScoopingMate
          )
        ),
        Category(
          i.horseKillingMethods,
          List(
            singleHorseCapturesKing,
            elbowHorse,
            palcornerHorse,
            anglerHorse,
            highAnglerHorse,
            octagonalHorse,
            springHorseMate,
            doubleHorsesMate
          )
        ),
        Category(
          i.cannonKillingMethods,
          List(
            doubleCannons,
            heavenAndEarthCannons,
            smotheredCannon,
            ironBolt,
            horseCannonMate,
            cannonsSandwichingChariot,
            crowningMate,
            doubleToastMate
          )
        ),
        Category(
          i.soldierKillingMethods,
          List(doubleGhostsKnocking, threeChariotsHarassingAdvisor, centroidPawnMate, repatriationOfBuddha)
        ),
        Category(i.generalKillingMethods, List(whiteFacedGeneral)),
        Category(i.otherNamedBasicKills, otherNamedBasicKills),
        Category(i.matingMethodsByPieceType, pieceTypeMates)
      )
    ),
    Section(
      i.basicTactic,
      List(
        Category(
          i.materialGain,
          List(
            winningMaterialByTrapping,
            winningMaterialByRestraint,
            winningMaterialBySkewer,
            winningMaterialByDoubleAttack
          )
        ),
        Category(
          i.pieceExchanges,
          List(exchangingToWinMaterial, exchangingToSeizeInitiative, exchangingToRelievePressure)
        )
      )
    ),
    Section(
      I18nKey.puzzle.mateThemes,
      List(
        Category(
          I18nKey.puzzle.mateThemes,
          List(mateIn1, mateIn2, mateIn3, mateIn4, mateIn5, mateIn6, mateIn7, mateIn8)
        )
      )
    )
  )

  val visible: List[PuzzleTheme] = categorized.flatMap(_.categories.flatMap(_.themes))
  // themes that can't be viewed by players
  private[puzzle] val hiddenThemes: List[PuzzleTheme] = List(checkFirst)

  private val legacyThemes: List[PuzzleTheme] = List(
    mix,
    advancedPawn,
    advantage,
    anastasiaMate,
    arabianMate,
    attackingF2F7,
    attraction,
    backRankMate,
    balestraMate,
    blindSwineMate,
    triangleMate,
    bishopEndgame,
    bodenMate,
    capturingDefender,
    collinearMove,
    castling,
    clearance,
    cornerMate,
    crushing,
    defensiveMove,
    deflection,
    discoveredAttack,
    discoveredCheck,
    doubleBishopMate,
    doubleCheck,
    dovetailMate,
    equality,
    endgame,
    epauletteMate,
    enPassant,
    exposedKing,
    fork,
    hangingPiece,
    hookMate,
    interference,
    intermezzo,
    kingsideAttack,
    killBoxMate,
    pillsburysMate,
    morphysMate,
    vukovicMate,
    knightEndgame,
    long,
    master,
    masterVsMaster,
    mate,
    mateIn1,
    mateIn2,
    mateIn3,
    mateIn4,
    mateIn5,
    mateIn6,
    mateIn7,
    mateIn8,
    smotheredMate,
    oneMove,
    operaMate,
    pawnEndgame,
    pin,
    promotion,
    queenEndgame,
    queenRookEndgame,
    queensideAttack,
    quietMove,
    rookEndgame,
    sacrifice,
    short,
    skewer,
    superGM,
    swallowstailMate,
    trappedPiece,
    underPromotion,
    veryLong,
    xRayAttack,
    zugzwang
  )

  private val all: List[PuzzleTheme] = visible ::: hiddenThemes ::: legacyThemes
  val hiddenThemesKey: Set[Key] = hiddenThemes.map(_.key).toSet

  private val byKey: Map[Key, PuzzleTheme] = all.mapBy(_.key)

  private val byLowerKey: Map[String, PuzzleTheme] = all.mapBy(_.key.value.toLowerCase)

  // themes that can't be voted by players
  val staticThemes: Set[Key] = Set(
    advantage,
    castling,
    crushing,
    enPassant,
    endgame,
    equality,
    long,
    master,
    masterVsMaster,
    superGM,
    mate,
    mateIn1,
    mateIn2,
    mateIn3,
    mateIn4,
    mateIn5,
    mateIn6,
    mateIn7,
    mateIn8,
    oneMove,
    short,
    smotheredMate,
    veryLong,
    checkFirst
  ).map(_.key)

  val allMates: Set[Key] = categorized.head.categories.flatMap(_.themes).map(_.key).toSet

  val studyChapterIds: Map[PuzzleTheme.Key, String] = List(
    advancedPawn -> "sw8VyTe1",
    attackingF2F7 -> "r1ZAcrjZ",
    attraction -> "3arGcr8n",
    backRankMate -> "VVzwe5vV",
    capturingDefender -> "2s7CaC2h",
    collinearMove -> "lRxwUFY2",
    castling -> "edXPYM70",
    discoveredAttack -> "DYcrqEPt",
    doubleCheck -> "EXAQJVNm",
    enPassant -> "G7ILIqhG",
    exposedKing -> "K882yZgm",
    fork -> "AUQW7PKS",
    hangingPiece -> "y65GVqXf",
    kingsideAttack -> "f62Rz8Qb",
    pin -> "WCTmpBFb",
    promotion -> "BNuCO8JO",
    skewer -> "iF38PGid",
    clearance -> "ZZsl7iCi",
    trappedPiece -> "ZJQkwFP6",
    sacrifice -> "ezFdOVtv",
    interference -> "nAojbDwV"
  ).view.map { (theme, id) =>
    theme.key -> id
  }.toMap

  def apply(key: Key): PuzzleTheme = byKey.getOrElse(key, mix)

  def findAny(key: String) = byLowerKey.get(key.toLowerCase)
  def findVisible(key: String) = findAny(key).filterNot(hiddenThemes.contains)

  def findOrMix(key: String) = findVisible(key) | mix

  def findDynamic(key: String) = findVisible(key).filterNot(t => staticThemes(t.key))
