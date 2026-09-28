from tools.xiangqi_data.puzzle_mining.discovery import DISCOVERY_VERSION
from contextlib import closing
import json, sqlite3, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from tools.puzzle_catalog.desktop.repository import ContentRepository


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.catalog = self.root / "catalog.sqlite3"
        self.mining = self.root / "mining.sqlite3"
        self.state = self.root / "state"
        with closing(sqlite3.connect(self.catalog)) as db, db:
            db.executescript(
                "CREATE TABLE catalog_puzzles(id TEXT PRIMARY KEY, document TEXT NOT NULL, evidence TEXT NOT NULL); CREATE TABLE catalog_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE catalog_releases(id TEXT PRIMARY KEY,document TEXT NOT NULL);"
            )
            from tools.puzzle_catalog.inventory import install

            install(db)

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, pid="abc12", retired=False, themes=None, evidence=None):
        p = {
            "_id": pid,
            "gameId": "g1",
            "gameSource": {"type": "native", "origin": "https://live"},
            "fen": "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
            "line": "a1a2 b10b9",
            "themes": themes or ["fork"],
            "retired": retired,
            "retirementReason": "test" if retired else None,
            "sourceSnapshot": {
                "initialFen": "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
                "moves": ["a1a2", "b10b9"],
                "players": [],
            },
        }
        with closing(sqlite3.connect(self.catalog)) as db, db:
            db.execute(
                "INSERT INTO catalog_puzzles VALUES(?,?,?)",
                (pid, json.dumps(p), json.dumps(evidence or {"status": "verified"})),
            )

    def test_missing_mining_is_empty_and_does_not_create_it(self):
        r = ContentRepository(self.catalog, self.root / "absent.sqlite3", self.state)
        self.assertEqual(r.stats()["mining"]["candidates"], 0)
        self.assertFalse((self.root / "absent.sqlite3").exists())

    def test_material_exchange_is_editable_and_filterable(self):
        self.add(themes=["winningMaterialByDoubleAttack"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["exchangingToWinMaterial"]')
        self.assertTrue(result[0]["ok"], result)
        self.assertEqual(repo.page(theme="exchangingToWinMaterial")["total"], 1)

    def test_pawn_triple_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["pawnTripleAdvancementAttack"]')
        self.assertTrue(result[0]["ok"], result)
        self.assertEqual(repo.page(theme="pawnTripleAdvancementAttack")["total"], 1)

    def test_bold_chariot_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["boldChariotAttack"]')
        self.assertTrue(result[0]["ok"], result)
        self.assertEqual(repo.page(theme="boldChariotAttack")["total"], 1)

    def test_cannon_motifs_are_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        for theme in ("doubleToastMate", "cannonsSandwichingChariot"):
            result = repo.moderate(["abc12"], "tags", json.dumps([theme]))
            self.assertTrue(result[0]["ok"], result)
            self.assertEqual(repo.page(theme=theme)["total"], 1)

    def test_new_pawn_mates_are_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        for theme in (
            "doubleGhostsKnocking",
            "childWorshipsBuddha",
            "crowningMate",
            "eunuchChasingEmperorKill",
        ):
            result = repo.moderate(["abc12"], "tags", json.dumps([theme]))
            self.assertTrue(result[0]["ok"], result)
            self.assertEqual(repo.page(theme=theme)["total"], 1)

    def test_iron_bolts_are_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        for theme in ("ironBolt", "smallIronBolt"):
            result = repo.moderate(["abc12"], "tags", '["' + theme + '"]')
            self.assertTrue(result[0]["ok"], result)
            self.assertEqual(repo.page(theme=theme)["total"], 1)

    def test_old_pawn_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["oldPawnSearchingMountain"]')
        self.assertTrue(result[0]["ok"], result)
        self.assertEqual(repo.page(theme="oldPawnSearchingMountain")["total"], 1)

    def test_terminal_motifs_are_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        for theme in (
            "stalemateMate",
            "leisurelyStrollMate",
            "headhunterCannonAttack",
            "crossCheckAttack",
        ):
            result = repo.moderate(["abc12"], "tags", '["' + theme + '"]')
            self.assertTrue(result[0]["ok"], result)
            self.assertEqual(repo.page(theme=theme)["total"], 1)

    def test_flanking_trio_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["flankingTrioMate", "mateIn1"]')
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="flankingTrioMate")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_multiple_check_mates_are_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        for theme in ("doubleCheckMate", "tripleCheckMate", "quadrupleCheckMate"):
            result = repo.moderate(["abc12"], "tags", json.dumps([theme, "mateIn1"]))
            self.assertTrue(result[0]["ok"], result)
            page = repo.page(theme=theme)
            self.assertEqual(page["total"], 1)
            self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_servant_crowding_master_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(
            ["abc12"], "tags", '["servantCrowdingMasterAttack", "mateIn1"]'
        )
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="servantCrowdingMasterAttack")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_double_cannons_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["doubleCannons", "mateIn1"]')
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="doubleCannons")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_white_faced_general_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["whiteFacedGeneral", "mateIn1"]')
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="whiteFacedGeneral")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_double_chariots_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["doubleChariotsMate", "mateIn1"]')
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="doubleChariotsMate")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_double_horses_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["doubleHorsesMate", "mateIn1"]')
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="doubleHorsesMate")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_smothered_cannon_is_editable_filterable_and_auditable(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            all_theme_versions,
        )
        from tools.xiangqi_data.puzzle_mining.smothered_cannon import THEME, VERSION

        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", json.dumps([THEME, "mateIn1"]))
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme=THEME)
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")
        self.assertEqual(all_theme_versions()[THEME], VERSION)

    def test_spring_horse_is_editable_filterable_and_auditable(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            all_theme_versions,
        )
        from tools.xiangqi_data.puzzle_mining.spring_horse import THEME, VERSION

        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", json.dumps([THEME, "mateIn1"]))
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme=THEME)
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")
        self.assertEqual(all_theme_versions()[THEME], VERSION)

    def test_throat_cutting_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["throatCuttingMate", "mateIn1"]')
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="throatCuttingMate")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_small_throat_cutting_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(
            ["abc12"], "tags", '["smallThroatCuttingMate", "mateIn1"]'
        )
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="smallThroatCuttingMate")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_chariots_threatening_advisor_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(
            ["abc12"], "tags", '["doubleChariotsThreateningAdvisor", "mateIn1"]'
        )
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="doubleChariotsThreateningAdvisor")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_moon_scooping_is_editable_and_filterable(self):
        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        result = repo.moderate(["abc12"], "tags", '["moonScoopingMate", "mateIn1"]')
        self.assertTrue(result[0]["ok"], result)
        page = repo.page(theme="moonScoopingMate")
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_horse_roles_are_editable_filterable_and_auditable(self):
        from tools.xiangqi_data.puzzle_mining.patterns import HORSE_ROLE_THEMES

        self.add(themes=["centroidPawnMate"])
        repo = ContentRepository(self.catalog, self.mining, self.state)
        for theme in HORSE_ROLE_THEMES:
            with self.subTest(theme=theme):
                result = repo.moderate(
                    ["abc12"], "tags", json.dumps([theme, "mateIn1"])
                )
                self.assertTrue(result[0]["ok"], result)
                page = repo.page(theme=theme)
                self.assertEqual(page["total"], 1)
                self.assertEqual(page["rows"][0]["key"], "abc12")

    def test_rows_filter_before_limit(self):
        self.add("abc12", themes=["fork"])
        self.add("abc13", themes=["mate"])
        r = ContentRepository(self.catalog, self.mining, self.state)
        out = r.page(theme="mate", limit=1)
        self.assertEqual(out["total"], 1)
        self.assertEqual(len(out["rows"]), 1)
        self.assertEqual(out["rows"][0]["key"], "abc13")

    def test_retired_status(self):
        self.add(retired=True)
        self.assertEqual(
            ContentRepository(self.catalog, self.mining, self.state).detail("abc12")[
                "status"
            ],
            "retired",
        )


class ModerationTests(unittest.TestCase):
    def setUp(self):
        # These projection fixtures intentionally omit the evidence ledger.
        # Real evidence reconciliation is covered by storage lifecycle tests.
        reconcile = patch("tools.puzzle_catalog.authoring.reconcile_assessments")
        reconcile.start()
        self.addCleanup(reconcile.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.catalog = self.root / "catalog.sqlite3"
        self.mining = self.root / "mining.sqlite3"
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.executescript(
                """CREATE TABLE puzzles(id TEXT,candidate_id INTEGER,game_id TEXT,fen TEXT,line TEXT,themes TEXT,solution_plies INTEGER,mate_in INTEGER,created_at TEXT,verification_status TEXT);
            CREATE TABLE candidates(id INTEGER,game_id TEXT,source_database TEXT,pre_fen TEXT,played_move TEXT,solution_json TEXT,themes_json TEXT,status TEXT,diagnostic TEXT,updated_at TEXT,candidate_type TEXT);
            CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE game_jobs(status TEXT,discovery_version TEXT); CREATE TABLE verification_jobs(status TEXT,candidate_id INTEGER,signature TEXT);"""
            )
            for i in range(4):
                db.execute(
                    "INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        i,
                        f"game{i}",
                        "masters",
                        "9/9/9/9/9/9/9/9/9/R8 w - - 0 1",
                        "a1a2",
                        None,
                        '["fork"]',
                        "published",
                        "",
                        "2026",
                        "checkmate_candidate",
                    ),
                )
                db.execute(
                    "INSERT INTO puzzles VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (
                        f"Ab{i:03}",
                        i,
                        f"game{i}",
                        "9/9/9/9/9/9/9/9/9/R8 w - - 0 1",
                        '["a1a2","a2a3"]',
                        '["fork"]',
                        1,
                        1,
                        "2026",
                        "active",
                    ),
                )
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.executescript("""
                ALTER TABLE candidates ADD COLUMN candidate_key TEXT;
                ALTER TABLE candidates ADD COLUMN current_verification_id INTEGER;
                ALTER TABLE candidates ADD COLUMN current_classification_id INTEGER;
                CREATE TABLE candidate_assessments(id INTEGER,candidate_id INTEGER,coverage TEXT,
                    accepted INTEGER DEFAULT 1,solution_plies INTEGER DEFAULT 1,
                    solution_json TEXT DEFAULT '["a7a6"]',branches_json TEXT DEFAULT '[{}]',
                    verification_settings_json TEXT);
                CREATE TABLE taxonomy_assessments(id INTEGER,verification_assessment_id INTEGER,taxonomy_version TEXT,status TEXT);
                CREATE TABLE category_assessments(candidate_id INTEGER,verification_assessment_id INTEGER,category TEXT,category_version TEXT,consensus_version TEXT,outcome TEXT,attempted_at TEXT);
            """)
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            encode_taxonomy_revision,
            taxonomy_versions,
        )

        from tools.xiangqi_data.puzzle_mining.position import PUZZLE_HISTORY_POLICY

        with closing(sqlite3.connect(self.mining)) as db, db:
            for cid in range(4):
                aid = cid + 100
                db.execute(
                    "INSERT INTO candidate_assessments(id,candidate_id,coverage,verification_settings_json) VALUES(?,?,'complete',?)",
                    (aid, cid, json.dumps({"history_policy": PUZZLE_HISTORY_POLICY})),
                )
                db.execute(
                    "INSERT INTO taxonomy_assessments VALUES(?,?,?,'classified')",
                    (aid, aid, encode_taxonomy_revision(taxonomy_versions())),
                )
                db.execute(
                    "UPDATE candidates SET candidate_key=?,current_verification_id=?,current_classification_id=? WHERE id=?",
                    (str(cid), aid, aid, cid),
                )
                self.seed_checks(db, cid, aid)
            db.commit()
            from tools.xiangqi_data.puzzle_mining.inventory import install

            install(db)
        self.repo = ContentRepository(self.catalog, self.mining, self.root / "state")

    @staticmethod
    def seed_checks(db, cid, aid):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            taxonomy_versions,
        )

        versions = taxonomy_versions()
        for name, version in versions.items():
            if not name.startswith("__"):
                db.execute(
                    "INSERT INTO category_assessments VALUES(?,?,?,?,?,'no_match','now')",
                    (cid, aid, name, version, versions["__consensus__"]),
                )

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_catalog_is_not_created_and_verified_candidates_are_visible(self):
        result = self.repo.page(status="uncategorized", limit=2)
        self.assertEqual(result["total"], 4)
        self.assertEqual(len(result["rows"]), 2)
        self.assertEqual(result["rows"][0]["line"], ["a1a2", "a2a3"])
        self.assertFalse(self.catalog.exists())

    def test_discovery_stats_only_count_current_revision(self):
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.executemany(
                "INSERT INTO game_jobs VALUES(?,?)",
                [
                    ("rejected", "old"),
                    ("queued", DISCOVERY_VERSION),
                    ("complete", DISCOVERY_VERSION),
                ],
            )
        jobs = self.repo.stats()["mining"]
        self.assertEqual(jobs["jobs"], 2)
        self.assertEqual(jobs["job_statuses"], {"queued": 1, "complete": 1})

    def test_awaiting_category_counts_only_ready_verification(self):
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute("UPDATE candidates SET current_classification_id=NULL")
        self.assertEqual(self.repo.stats()["pipeline"]["awaiting_category"], 4)
        for field, value in (
            ("accepted", 0),
            ("coverage", "legacy"),
            ("verification_settings_json", "{}"),
            ("solution_plies", 0),
            ("branches_json", None),
        ):
            with self.subTest(field=field):
                with closing(sqlite3.connect(self.mining)) as db, db:
                    previous = db.execute(
                        f"SELECT {field} FROM candidate_assessments"
                    ).fetchone()[0]
                    db.execute(f"UPDATE candidate_assessments SET {field}=?", (value,))
                self.assertEqual(self.repo.stats()["pipeline"]["awaiting_category"], 0)
                with closing(sqlite3.connect(self.mining)) as db, db:
                    db.execute(
                        f"UPDATE candidate_assessments SET {field}=?", (previous,)
                    )
        self.assertEqual(self.repo.stats()["pipeline"]["awaiting_category"], 4)

    def test_pipeline_counts_only_current_complete_categorized_output(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            encode_taxonomy_revision,
            taxonomy_versions,
        )

        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute(
                "UPDATE candidates SET current_verification_id=NULL,current_classification_id=NULL"
            )
            from tools.xiangqi_data.puzzle_mining.position import PUZZLE_HISTORY_POLICY

            db.execute(
                "INSERT INTO candidate_assessments(id,candidate_id,coverage,verification_settings_json) VALUES(1,0,'complete',?)",
                (json.dumps({"history_policy": PUZZLE_HISTORY_POLICY}),),
            )
            db.execute("UPDATE candidates SET current_verification_id=1 WHERE id=0")
            db.execute(
                "UPDATE puzzles SET themes=? WHERE candidate_id=0",
                (json.dumps(["centroidPawnMate", "mateIn1"]),),
            )
        pipeline = self.repo.stats()["pipeline"]
        self.assertEqual(
            (
                pipeline["verified"],
                pipeline["awaiting_category"],
                pipeline["categorized"],
            ),
            (1, 1, 0),
        )
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute(
                "INSERT INTO taxonomy_assessments VALUES(1,1,?,'classified')",
                (encode_taxonomy_revision(taxonomy_versions()),),
            )
            db.execute("UPDATE candidates SET current_classification_id=1 WHERE id=0")
            self.seed_checks(db, 0, 1)
        pipeline = self.repo.stats()["pipeline"]
        self.assertEqual(
            (
                pipeline["verified"],
                pipeline["awaiting_category"],
                pipeline["categorized"],
            ),
            (1, 0, 1),
        )
        self.assertEqual(
            self.repo.page(status="unpublished")["total"], pipeline["categorized"]
        )
        self.assertEqual(self.repo.detail("Ab000")["status"], "unpublished")
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute(
                "UPDATE taxonomy_assessments SET taxonomy_version='{}' WHERE id=1"
            )
        self.assertEqual(self.repo.detail("Ab000")["status"], "awaiting_classification")
        self.assertEqual(self.repo.stats()["pipeline"]["categorized"], 0)
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute("UPDATE candidate_assessments SET coverage='legacy' WHERE id=1")
        self.assertEqual(self.repo.detail("Ab000")["status"], "awaiting_verification")
        self.repo.moderate(["Ab000"], "reject", "exclude")
        self.assertEqual(self.repo.stats()["pipeline"]["categorized"], 0)

    def test_authored_and_mined_output_share_readiness_and_count(self):
        from tools.puzzle_catalog.catalog import PuzzleCatalog

        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute(
                "UPDATE puzzles SET themes=? WHERE id='Ab000'",
                (json.dumps(["centroidPawnMate", "mateIn1"]),),
            )
        self.assertEqual(self.repo.detail("Ab000")["status"], "unpublished")
        self.assertEqual(self.repo.stats()["pipeline"]["categorized"], 1)
        document = self.repo.detail("Ab000")["document"]
        with PuzzleCatalog(self.catalog) as catalog:
            with catalog.db:
                catalog.db.execute(
                    "INSERT INTO catalog_puzzles VALUES(?,?,?)",
                    ("Ab000", json.dumps(document), json.dumps({"status": "verified"})),
                )
        self.assertEqual(self.repo.detail("Ab000")["status"], "unpublished")
        self.assertEqual(self.repo.page(status="unpublished")["total"], 1)
        self.assertEqual(self.repo.stats()["pipeline"]["categorized"], 1)
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute(
                "UPDATE puzzles SET verification_status='withdrawn' WHERE id='Ab000'"
            )
        self.assertEqual(self.repo.detail("Ab000")["status"], "withdrawn")
        self.assertEqual(self.repo.stats()["pipeline"]["categorized"], 0)

    def test_rejection_is_durable_until_restored(self):
        result = self.repo.moderate(["Ab000"], "reject", "Bad source")
        self.assertTrue(result[0]["ok"])
        self.assertEqual(self.repo.detail("Ab000")["status"], "rejected")
        self.assertEqual(self.repo.page(status="uncategorized", limit=1)["total"], 3)
        self.assertFalse(self.catalog.exists())
        with self.assertRaises(ValueError):
            self.repo.moderate(["Ab000"], "restore_review")
        self.assertEqual(self.repo.page(library=True)["total"], 3)

    def test_uncategorized_library_pools_use_verified_solutions_and_named_categories(
        self,
    ):
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute("UPDATE candidates SET current_classification_id=NULL")
            db.execute(
                "UPDATE candidates SET candidate_type='tactic_candidate' WHERE id=1"
            )
            db.execute('UPDATE puzzles SET themes=\'["mate","mateIn1","mateIn2"]\'')
            db.execute(
                'UPDATE puzzles SET themes=\'["doubleCannons","mateIn1"]\' WHERE candidate_id=2'
            )
            db.execute(
                "UPDATE candidate_assessments SET accepted=0 WHERE candidate_id=3"
            )
        for pool, expected in (
            ("uncategorized_checkmate", "Ab000"),
            ("uncategorized_tactic", "Ab001"),
        ):
            page = self.repo.page(library=True, status=pool)
            self.assertEqual([row["id"] for row in page["rows"]], [expected])
            self.assertEqual(page["rows"][0]["status"], pool)
            self.assertEqual(
                self.repo.page(library=True, status=pool, query="missing")["total"], 0
            )
            self.assertEqual(
                self.repo.page(
                    library=True, status=pool, theme="mateIn1", source="masters"
                )["total"],
                1,
            )
        self.assertEqual(self.repo.page(library=True)["total"], 2)
        self.assertEqual(self.repo.page(library=True, status="unpublished")["total"], 0)

    def test_uncategorized_library_requires_complete_current_policy_evidence(self):
        for field, value in (
            ("accepted", 0),
            ("coverage", "partial"),
            ("solution_plies", 0),
            ("solution_json", None),
            ("branches_json", None),
            ("verification_settings_json", "{}"),
        ):
            with self.subTest(field=field):
                with closing(sqlite3.connect(self.mining)) as db, db:
                    previous = db.execute(
                        f"SELECT {field} FROM candidate_assessments LIMIT 1"
                    ).fetchone()[0]
                    db.execute(f"UPDATE candidate_assessments SET {field}=?", (value,))
                self.assertEqual(
                    self.repo.page(library=True, status="uncategorized_checkmate")[
                        "total"
                    ],
                    0,
                )
                with closing(sqlite3.connect(self.mining)) as db, db:
                    db.execute(
                        f"UPDATE candidate_assessments SET {field}=?", (previous,)
                    )

    def test_admission_excludes_rejections_and_withdrawn_output(self):
        self.repo.moderate(["Ab000"], "reject")
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute(
                "UPDATE puzzles SET verification_status='withdrawn' WHERE id='Ab001'"
            )
        with patch("tools.puzzle_catalog.desktop.repository.admit_candidate") as admit:
            progress = []
            self.assertEqual(
                self.repo.admit_ready(
                    None,
                    progress=lambda done, total: progress.append((done, total)),
                    include_uncategorized=True,
                ),
                2,
            )
            self.assertEqual(progress, [(0, 2), (2, 2)])
            self.assertEqual(
                [c.args[2] for c in admit.call_args_list], ["Ab002", "Ab003"]
            )

    def test_default_admission_requires_official_category(self):
        with closing(sqlite3.connect(self.mining)) as db, db:
            db.execute("UPDATE puzzles SET themes=? WHERE id='Ab000'", ('["mate"]',))
            db.execute("UPDATE puzzles SET themes=? WHERE id='Ab001'", ('["mateIn8"]',))
            db.execute(
                "UPDATE puzzles SET themes=? WHERE id='Ab002'", ('["octagonalHorse"]',)
            )
            db.execute(
                "UPDATE puzzles SET themes=? WHERE id='Ab003'",
                ('["whiteFacedGeneral"]',),
            )
        with patch("tools.puzzle_catalog.desktop.repository.admit_candidate") as admit:
            self.assertEqual(self.repo.admit_ready(None), 2)
            self.assertEqual(
                [c.args[2] for c in admit.call_args_list], ["Ab002", "Ab003"]
            )

    def test_admission_validation_failure_blocks_release(self):
        with patch(
            "tools.puzzle_catalog.desktop.repository.admit_candidate",
            side_effect=ValueError("stale verification"),
        ):
            with self.assertRaisesRegex(
                ValueError, "Ab000.*stale verification.*not started"
            ):
                self.repo.admit_ready(None, include_uncategorized=True)

    def test_partial_moderation_reports_each_item(self):
        result = self.repo.moderate(["Ab000", "missing"], "reject", "Reviewed")
        self.assertTrue(result[0]["ok"])
        self.assertFalse(result[1]["ok"])
        self.assertEqual(self.repo.detail("Ab000")["status"], "rejected")


if __name__ == "__main__":
    unittest.main()
