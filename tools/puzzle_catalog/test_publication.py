import unittest
from tools.puzzle_catalog.test_catalog import Tests, puzzle
from tools.puzzle_catalog.catalog import CatalogError
from tools.puzzle_catalog.publication import (
    officially_categorized,
    validate_release_categories,
)
from tools.puzzle_catalog.desktop.settings import Settings


class PublicationTests(Tests):
    def test_pawn_triple_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("TriPw")
            p["gameId"] = "pawn-triple-game"
            p["themes"] = ["pawnTripleAdvancementAttack"]
            c.admit(p, {"status": "verified", "assessmentId": "pawn-triple"})
            release = c.build_release()
            self.assertIn("TriPw", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_bold_chariot_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("BoldR")
            p["gameId"] = "bold-chariot-game"
            p["themes"] = ["boldChariotAttack"]
            c.admit(p, {"status": "verified", "assessmentId": "bold-chariot"})
            release = c.build_release()
            self.assertIn("BoldR", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_material_exchange_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("ExMat")
            p["gameId"] = "exchange-material-game"
            p["themes"] = ["exchangingToWinMaterial"]
            c.admit(p, {"status": "verified", "assessmentId": "exchange-material"})
            release = c.build_release()
            self.assertIn("ExMat", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_cannon_motifs_are_admitted_to_release(self):
        with self.c() as c:
            for pid, theme in (
                ("Toast", "doubleToastMate"),
                ("Sandw", "cannonsSandwichingChariot"),
            ):
                p = puzzle(pid)
                p["gameId"] = "game-" + pid
                p["themes"] = [theme]
                c.admit(p, {"status": "verified", "assessmentId": pid})
            release = c.build_release()
            self.assertTrue(
                {"Toast", "Sandw"} <= {p["_id"] for p in release["puzzles"]}
            )
            validate_release_categories(release["puzzles"])

    def test_new_pawn_mates_are_admitted_to_release(self):
        with self.c() as c:
            for pid, theme in (
                ("Ghost", "doubleGhostsKnocking"),
                ("Elixr", "threeImmortalsRefiningTheElixir"),
                ("Buddh", "repatriationOfBuddha"),
                ("Disrb", "generalDisrobingAttack"),
                ("Asist", "assistingKingAttack"),
                ("Child", "childWorshipsBuddha"),
                ("Crown", "crowningMate"),
                ("Chase", "eunuchChasingEmperorKill"),
            ):
                p = puzzle(pid)
                p["gameId"] = "game-" + pid
                p["themes"] = [theme]
                c.admit(p, {"status": "verified", "assessmentId": pid})
            release = c.build_release()
            self.assertTrue(
                {"Asist", "Disrb", "Buddh", "Elixr", "Ghost", "Child", "Crown", "Chase"}
                <= {p["_id"] for p in release["puzzles"]}
            )
            validate_release_categories(release["puzzles"])

    def test_iron_bolts_are_admitted_to_release(self):
        with self.c() as c:
            for pid, theme in (("IronB", "ironBolt"), ("SmIrB", "smallIronBolt")):
                p = puzzle(pid)
                p["gameId"] = "game-" + pid
                p["themes"] = [theme]
                c.admit(p, {"status": "verified", "assessmentId": pid})
            release = c.build_release()
            self.assertTrue(
                {"IronB", "SmIrB"} <= {p["_id"] for p in release["puzzles"]}
            )
            validate_release_categories(release["puzzles"])

    def test_old_pawn_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("OldPw")
            p["gameId"] = "old-pawn-game"
            p["themes"] = ["oldPawnSearchingMountain"]
            c.admit(p, {"status": "verified", "assessmentId": "old-pawn"})
            release = c.build_release()
            self.assertIn("OldPw", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_cannon_chariot_discovery_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("CcdAt")
            p["gameId"] = "cannon-chariot-discovery-game"
            p["themes"] = ["cannonChariotDiscoveredAttack"]
            c.admit(
                p, {"status": "verified", "assessmentId": "cannon-chariot-discovery"}
            )
            release = c.build_release()
            self.assertIn("CcdAt", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_detonating_mine_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("DetMi")
            p["gameId"] = "detonating-mine-game"
            p["themes"] = ["detonatingMineAttack"]
            c.admit(p, {"status": "verified", "assessmentId": "detonating-mine"})
            release = c.build_release()
            self.assertIn("DetMi", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_terminal_motifs_are_admitted_to_release(self):
        with self.c() as c:
            for index, theme in enumerate(
                (
                    "stalemateMate",
                    "leisurelyStrollMate",
                    "headhunterCannonAttack",
                    "crossCheckAttack",
                )
            ):
                p = puzzle(f"End{index:02}")
                p["gameId"] = f"terminal-game-{index}"
                p["themes"] = [theme]
                c.admit(p, {"status": "verified", "assessmentId": f"terminal-{index}"})
            release = c.build_release()
            self.assertTrue(
                {f"End{i:02}" for i in range(4)}
                <= {p["_id"] for p in release["puzzles"]}
            )
            validate_release_categories(release["puzzles"])

    def test_flanking_trio_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("Flank")
            p["gameId"] = "g2"
            p["themes"] = ["flankingTrioMate", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "flanking-trio"})
            release = c.build_release()
            self.assertIn("Flank", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_multiple_check_mates_are_admitted_to_release(self):
        with self.c() as c:
            for pid, theme in (
                ("Dblck", "doubleCheckMate"),
                ("Trpck", "tripleCheckMate"),
                ("Qudck", "quadrupleCheckMate"),
            ):
                p = puzzle(pid)
                p["gameId"] = pid
                p["themes"] = [theme, "mateIn1"]
                c.admit(p, {"status": "verified", "assessmentId": theme})
            release = c.build_release()
            self.assertTrue(
                {"Dblck", "Trpck", "Qudck"} <= {p["_id"] for p in release["puzzles"]}
            )
            validate_release_categories(release["puzzles"])

    def test_servant_crowding_master_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("Srvnt")
            p["gameId"] = "g2"
            p["themes"] = ["servantCrowdingMasterAttack", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "servant-crowding"})
            release = c.build_release()
            self.assertIn("Srvnt", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_smothered_cannon_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("Smthr")
            p["gameId"] = "g2"
            p["themes"] = ["smotheredCannon", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "smothered-cannon"})
            release = c.build_release()
            self.assertIn("Smthr", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_spring_horse_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("Sprng")
            p["gameId"] = "g2"
            p["themes"] = ["springHorseMate", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "spring-horse"})
            release = c.build_release()
            self.assertIn("Sprng", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_double_cannons_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("White")
            p["gameId"] = "g2"
            p["themes"] = ["doubleCannons", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "white-general"})
            release = c.build_release()
            self.assertIn("White", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_white_faced_general_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("White")
            p["gameId"] = "g2"
            p["themes"] = ["whiteFacedGeneral", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "white-general"})
            release = c.build_release()
            self.assertIn("White", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_double_chariots_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("White")
            p["gameId"] = "g2"
            p["themes"] = ["doubleChariotsMate", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "white-general"})
            release = c.build_release()
            self.assertIn("White", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_throat_cutting_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("White")
            p["gameId"] = "g2"
            p["themes"] = ["throatCuttingMate", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "white-general"})
            release = c.build_release()
            self.assertIn("White", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_small_throat_cutting_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("White")
            p["gameId"] = "g2"
            p["themes"] = ["smallThroatCuttingMate", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "white-general"})
            release = c.build_release()
            self.assertIn("White", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_chariots_threatening_advisor_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("White")
            p["gameId"] = "g2"
            p["themes"] = ["doubleChariotsThreateningAdvisor", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "white-general"})
            release = c.build_release()
            self.assertIn("White", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_moon_scooping_is_admitted_to_release(self):
        with self.c() as c:
            p = puzzle("White")
            p["gameId"] = "g2"
            p["themes"] = ["moonScoopingMate", "mateIn1"]
            c.admit(p, {"status": "verified", "assessmentId": "white-general"})
            release = c.build_release()
            self.assertIn("White", [p["_id"] for p in release["puzzles"]])
            validate_release_categories(release["puzzles"])

    def test_all_horse_roles_are_admitted_to_release(self):
        from tools.xiangqi_data.puzzle_mining.patterns import HORSE_ROLE_THEMES

        with self.c() as c:
            for index, theme in enumerate(HORSE_ROLE_THEMES):
                p = puzzle(f"Hors{index}")
                p["gameId"] = f"horse{index}"
                p["themes"] = [theme, "mateIn1"]
                c.admit(p, {"status": "verified", "assessmentId": theme})
            release = c.build_release()
            for theme in HORSE_ROLE_THEMES:
                self.assertTrue(any(theme in p["themes"] for p in release["puzzles"]))
            validate_release_categories(release["puzzles"])

    def test_filter_new_draft_puzzles_and_explicit_override(self):
        with self.c() as c:
            p = puzzle("00002")
            p["gameId"] = "g2"
            p["themes"] = ["mate"]
            c.admit(p, {"status": "verified", "assessmentId": "test"})
            self.assertEqual(len(c.build_release()["puzzles"]), 1)
            self.assertEqual(
                len(c.build_release(include_uncategorized=True)["puzzles"]), 2
            )
            self.assertEqual(len(c.puzzles()), 2)

    def test_published_ids_cannot_be_silently_omitted(self):
        with self.c() as c:
            import json

            p = c.puzzles()[0]
            p["themes"] = ["mate"]
            with c.db:
                c.db.execute("UPDATE catalog_puzzles SET document=?", (json.dumps(p),))
            with self.assertRaisesRegex(CatalogError, "retired explicitly"):
                c.build_release()
            c.retire(p["_id"], "No official category")
            self.assertTrue(c.build_release()["puzzles"][0]["retired"])

    def test_official_categories_only(self):
        for theme in [
            "centroidPawnMate",
            "octagonalHorse",
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
        ]:
            self.assertTrue(officially_categorized({"themes": [theme]}))
        for themes in [[], ["mate"], ["opening", "middlegame"], ["fork"], ["mateIn9"]]:
            self.assertFalse(officially_categorized({"themes": themes}))
        for i in range(1, 9):
            self.assertFalse(officially_categorized({"themes": [f"mateIn{i}"]}))
            self.assertTrue(
                officially_categorized({"themes": [f"mateIn{i}", "octagonalHorse"]})
            )
        self.assertFalse(hasattr(Settings(), "include_uncategorized"))
        Settings().validate()


class FrozenPolicyTests(unittest.TestCase):
    def test_frozen_release_cannot_bypass_default_or_restore_removed_tags(self):
        p = puzzle()
        p["themes"] = ["mate"]
        with self.assertRaisesRegex(ValueError, "no official category"):
            validate_release_categories([p])
        validate_release_categories([p], include_uncategorized=True)
        p["themes"] = ["centroidPawnMate", "opening"]
        for allow in [False, True]:
            with self.assertRaisesRegex(ValueError, "removed phase"):
                validate_release_categories([p], include_uncategorized=allow)
