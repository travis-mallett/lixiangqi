"""Official LiXiangQi publication categories, distinct from auxiliary tags."""

OFFICIAL_THEMES = frozenset(
    {
        "doubleChariotsMate",
        "throatCuttingMate",
        "smallThroatCuttingMate",
        "doubleChariotsThreateningAdvisor",
        "moonScoopingMate",
        "singleHorseCapturesKing",
        "elbowHorse",
        "palcornerHorse",
        "anglerHorse",
        "highAnglerHorse",
        "octagonalHorse",
        "springHorseMate",
        "doubleHorsesMate",
        "doubleCannons",
        "heavenAndEarthCannons",
        "smotheredCannon",
        "servantCrowdingMasterAttack",
        "doubleCheckMate",
        "tripleCheckMate",
        "quadrupleCheckMate",
        "flankingTrioMate",
        "oldPawnSearchingMountain",
        "stalemateMate",
        "leisurelyStrollMate",
        "headhunterCannonAttack",
        "crossCheckAttack",
        "cannonChariotDiscoveredAttack",
        "detonatingMineAttack",
        "ironBolt",
        "smallIronBolt",
        "horseCannonMate",
        "cannonsSandwichingChariot",
        "crowningMate",
        "childWorshipsBuddha",
        "eunuchChasingEmperorKill",
        "doubleToastMate",
        "boldChariotAttack",
        "pawnTripleAdvancementAttack",
        "doubleGhostsKnocking",
        "threeImmortalsRefiningTheElixir",
        "threeChariotsHarassingAdvisor",
        "centroidPawnMate",
        "repatriationOfBuddha",
        "whiteFacedGeneral",
        "chariotMatingMethods",
        "horseMatingMethods",
        "cannonMatingMethods",
        "soldierMatingMethods",
        "chariotHorseMatingMethods",
        "chariotCannonMatingMethods",
        "chariotSoldierMatingMethods",
        "horseCannonMatingMethods",
        "horseSoldierMatingMethods",
        "cannonSoldierMatingMethods",
        "chariotHorseCannonMatingMethods",
        "chariotHorseSoldierMatingMethods",
        "chariotCannonSoldierMatingMethods",
        "horseCannonSoldierMatingMethods",
        "chariotHorseCannonSoldierMatingMethods",
        "winningMaterialByTrapping",
        "winningMaterialByRestraint",
        "winningMaterialBySkewer",
        "winningMaterialByDoubleAttack",
        "exchangingToWinMaterial",
        "exchangingToSeizeInitiative",
        "exchangingToRelievePressure",
    }
)
EDITABLE_THEMES = OFFICIAL_THEMES | frozenset(f"mateIn{i}" for i in range(1, 9))


def officially_categorized(puzzle):
    return bool(OFFICIAL_THEMES.intersection(puzzle.get("themes", [])))


def validate_release_categories(puzzles, *, include_uncategorized=False):
    for puzzle in puzzles:
        if {"opening", "middlegame"}.intersection(puzzle.get("themes", [])):
            raise ValueError(
                f"Puzzle {puzzle['_id']} has removed phase tags. Clean the local catalog and build a new release."
            )
        if (
            not include_uncategorized
            and not puzzle.get("retired")
            and not officially_categorized(puzzle)
        ):
            raise ValueError(
                f"Puzzle {puzzle['_id']} has no official category. A supported basic kill or basic tactic theme is required; mate depth alone is insufficient."
            )
