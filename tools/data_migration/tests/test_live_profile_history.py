"""Replay the packaged live profile history step against an isolated MongoDB."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest
import uuid

URI = os.environ.get("LIXIANGQI_MIGRATION_TEST_URI")
SHELL = os.environ.get("LIXIANGQI_MONGOSH") or shutil.which("mongosh")
SCRIPT = Path(__file__).resolve().parents[1] / "20261123_correspondence_ranks.sh"


@unittest.skipUnless(URI and SHELL, "isolated MongoDB and mongosh required")
class LiveProfileHistoryTest(unittest.TestCase):
    def evaluate(self, js):
        subprocess.run([SHELL, URI, "--quiet", "--eval",
                        f"db=db.getSiblingDB({json.dumps(self.database)});\n" + js],
                       check=True, timeout=60)

    def test_preserves_existing_days_and_excludes_correspondence(self):
        self.database = "live_chart_test_" + uuid.uuid4().hex
        self.addCleanup(self.evaluate, "db.dropDatabase()")
        self.evaluate("""
          for (const track of ["xiangqi","jieqi","minixiangqi","manchu","threeKingdoms"]) {
            const at = new Date("2026-09-01"), last = new Date("2026-09-03");
            db.user_perf.insertOne({_id:track,ranks:{[track]:{s:12,nb:2,la:last,st:[{g:track,d:2}]}},
              rankHistory:{[track]:{"2026-09-03":17}}});
            if (track === "threeKingdoms") {
              const seats = [{userId:track,rank:{established:true,score:10,diff:2}}];
              db.three_kingdoms_game.insertOne({_id:track,users:[track],seats,rated:true,finished:true,
                createdAt:at,movedAt:new Date("2026-09-02")});
              db.three_kingdoms_game.insertOne({_id:"postal",users:[track],seats,rated:true,
                createdAt:new Date("2026-08-01"),clock:{config:{days:2}}});
            } else {
              db.game5.insertOne({_id:track,us:["opponent",track],rt:track,ca:at,co:new Date("2026-09-02"),
                p1:{rk:{t:track,e:true,s:10,d:2}}});
            }
          }""")
        replay = SCRIPT.read_text().split("<<'MONGO'\n", 1)[1].split("\nMONGO", 1)[0]
        self.evaluate(replay)
        self.evaluate(replay)
        self.evaluate("""
          db.user_perf.find().forEach(u => {
            const h = u.rankHistory[u._id];
            if (Object.keys(h).length !== 3 || h["2026-09-01"] !== 10 ||
                h["2026-09-02"] !== 12 || h["2026-09-03"] !== 17 || u.ranks[u._id].s !== 12)
              throw Error("Incorrect live history for "+u._id);
          });
          if (db.schema_migration.countDocuments({_id:"live_profile_history_v1"}) !== 1)
            throw Error("Missing completion marker");""")
