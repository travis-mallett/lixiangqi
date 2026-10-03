"""Exercise actual neighboring push-local-live orchestration, without a server."""

from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import tempfile
import unittest
from unittest.mock import patch

DEPLOYMENT = Path(os.environ.get("LIXIANGQI_DEPLOYMENT_ROOT", Path(__file__).resolve().parents[4] / "lixiangqi-beta-deployment"))


@unittest.skipUnless((DEPLOYMENT / "push_transport.py").exists(), "neighboring deployment checkout required")
class StudyDeploymentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = spec_from_file_location("study_test_transport", DEPLOYMENT / "push_transport.py")
        cls.transport = module_from_spec(spec)
        spec.loader.exec_module(cls.transport)

    def test_analysis_catalog_mount_supports_wal_during_activation_and_recovery(self):
        remote = "/opt/site with spaces"
        expected = remote + "/data/sqlite:/analysis-catalog:rw"
        commands = (
            self.transport.analysis_migration_apply_command(remote),
            self.transport.study_migration_recovery_command(remote),
        )
        for command in commands:
            tokens = shlex.split(command)
            mounts = [tokens[i + 1] for i, token in enumerate(tokens[:-1]) if token == "-v"]
            # Both prepare and apply use the migration container; ordinary explorer
            # service mounts remain read-only. Recovery must work without rebuilding.
            self.assertEqual(mounts.count(expected), 2)
            self.assertIn("--phase prepare --catalog /analysis-catalog/xiangqi-games.sqlite3", command)
            self.assertNotIn(remote + "/data/sqlite:/app/data/local:rw", mounts)
        compose = (DEPLOYMENT / "upload/compose.yaml").read_text()
        self.assertIn("./data/sqlite:/app/data/local:ro", compose)

    def test_reset_is_last_migration_before_resuming_writers(self):
        transport = self.transport
        plan = transport.changed_services({transport.STUDY_MIGRATION_SCRIPT}, set())
        command = transport.activation_command("/opt/lixiangqi", plan)
        reset = command.index("-m tools.data_migration.20260929_native_study_v1")
        self.assertLess(command.index("docker compose stop lila lila-ws explorer pikafish-worker"), reset)
        self.assertLess(command.index("docker compose stop pikafish-analysis"), reset)
        self.assertLess(command.index("-m tools.data_migration.20260920_puzzle_playback"), reset)
        self.assertLess(reset, command.rindex("committed"))
        self.assertIn("explorer", plan["build"])
        self.assertIn("--writers-stopped", command)
        self.assertIn("-native-study-v1-backup:/study-backup", command)
        analysis = command.index("-m tools.data_migration.20260929_native_analysis_moves_v1")
        self.assertLess(reset, analysis)
        self.assertLess(command.index("--phase prepare"), command.index("lila.tree.NativeAnalysisMigration"))
        self.assertLess(command.index("lila.tree.NativeAnalysisMigration"), command.index("--phase apply"))
        self.assertNotIn("--search-disabled", command)

    def test_rollback_requires_identical_study_schema_contract(self):
        command = self.transport.code_rollback_command("/opt/lixiangqi")
        self.assertIn(self.transport.STUDY_MIGRATION_SCRIPT, command)
        self.assertIn("cmp -s", command)
        before = self.transport.rollback_command("/opt/lixiangqi")
        self.assertIn("Native study reset requires forward recovery", before)

    def test_reset_failure_cannot_resume_old_writers(self):
        self.execute_recovery(reset="false; ", expected=1)

    def test_interrupted_reset_finishes_new_activation(self):
        self.execute_recovery(reset="echo reset-complete; ", expected=20)

    def execute_recovery(self, reset, expected):
        bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        if not Path(bash).is_file():
            self.skipTest("Bash required")
        with tempfile.TemporaryDirectory() as temporary:
            remote = Path(temporary) / "site"
            remote.mkdir()
            Path(str(remote) + ".operation.json").write_text('{"phase":"gated"}')
            Path(self.transport.study_migration_pending(remote.as_posix())).touch()
            with patch.object(self.transport, "study_migration_apply_command", return_value=reset), \
                 patch.object(self.transport, "analysis_migration_apply_command", return_value=":; "), \
                 patch.object(self.transport, "rank_migration_commit_command", return_value=":; "), \
                 patch.object(self.transport, "video_migration_commit_command", return_value=":; "), \
                 patch.object(self.transport, "journal_command", return_value=":; "), \
                 patch.object(self.transport, "start_committed_command", return_value="echo native-writers-started; "), \
                 patch.object(self.transport, "rollback_command", return_value="echo UNSAFE-OLD-WRITERS; "):
                command = self.transport.recovery_command(remote.as_posix())
            script = Path(temporary) / "recover.sh"
            script.write_text("docker() { :; }; " + command, encoding="utf-8", newline="\n")
            result = subprocess.run([bash, str(script)], capture_output=True, text=True)
            self.assertEqual(result.returncode, expected, result.stderr)
            self.assertNotIn("UNSAFE-OLD-WRITERS", result.stdout)
            self.assertEqual("native-writers-started" in result.stdout, expected == 20)

    def test_release_packages_and_checks_exact_script(self):
        source = (DEPLOYMENT / "push-local-live.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("$StudyMigration", source)
        self.assertIn("'data_migration\\20260929_native_study_v1.py'", source)
        self.assertIn("The packaged native study migration differs from the source", source)
        self.assertIn("The packaged native analysis migration differs from the source", source)
        self.assertIn('"-Dlixiangqi.source=$StageSource"', source)
        self.assertIn("native-xiangqi/$relative=", source)
        self.assertIn("external/pikafish_worker", source)
        self.assertIn("tools/xiangqi_data/pikafish.py", source)
        self.assertIn("Release inputs changed during assembly", source)

    def test_native_image_service_is_built_and_health_gated(self):
        plan = self.transport.changed_services({"runtime/image-export/dist/server.mjs"}, set())
        self.assertIn("image-export", plan["build"])
        self.assertIn("image-export", plan["recreate"])
        self.assertIn("image_service", self.transport.start_committed_command("/opt/lixiangqi"))
        self.assertIn('game.gifUrl = "http://image-export:6175"',
                      (DEPLOYMENT / "templates/lila-application.beta.conf").read_text())
        restart = (DEPLOYMENT / "upload/scripts/start.sh").read_text()
        self.assertIn("--no-deps image-export lila lila-ws explorer pikafish-worker caddy", restart)
        self.assertIn("LIXIANGQI_FISHNET_KEY", restart)
        self.assertIn("--no-deps pikafish-analysis", restart)

    def test_optional_native_worker_starts_only_with_configured_credentials(self):
        bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        if not Path(bash).is_file():
            self.skipTest("Bash required")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            configuration = root / "compose.json"
            calls = root / "calls.txt"
            script = root / "worker.sh"
            script.write_text('''set -e
docker() {
  case "$*" in
    *"config --format json"*) cat "$CONFIGURATION" ;;
    *) printf '%s\\n' "$*" >> "$CALLS" ;;
  esac
}
''' + self.transport.start_native_analysis_command(), encoding="utf-8", newline="\n")
            for key in ("", "fixture-secret-never-print"):
                configuration.write_text(json.dumps({"services": {"pikafish-analysis": {"environment": {"LIXIANGQI_FISHNET_KEY": key}}}}))
                calls.write_text("")
                result = subprocess.run([bash, str(script)],
                    env={**os.environ, "CONFIGURATION": configuration.as_posix(), "CALLS": calls.as_posix()},
                    capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertNotIn("fixture-secret-never-print", result.stdout + result.stderr + calls.read_text())
                self.assertEqual("up -d" in calls.read_text(), bool(key))
                self.assertEqual("unconfigured" in result.stdout, not bool(key))
        source = (DEPLOYMENT / "push-local-live.ps1").read_text()
        self.assertIn("'xiangqi_data\\pikafish.py'", source)
        self.assertIn("'external\\pikafish_worker\\analysis.py'", source)

    def test_preview_image_cleanup_requires_exact_executable_and_module(self):
        shell = shutil.which("powershell.exe")
        if not shell or os.name != "nt":
            self.skipTest("Windows PowerShell lifecycle")
        command = r'''
$ErrorActionPreference = 'Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:TEST_SCRIPT,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$definition=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Stop-ImageExporter'},$false)[0]
. ([scriptblock]::Create($definition.Extent.Text))
function Write-Step([string]$message) {}
function Get-CimInstance { $script:inventory }
function Get-NetTCPConnection { $script:listener }
function Stop-Process([int]$Id,[switch]$Force) { $script:stopped += $Id; if ($script:listener.OwningProcess -eq $Id) { $script:listener=$null } }
$node='C:\tools\node.exe'; $server='Z:\project with spaces\tools\image_export\dist\server.mjs'
$script:inventory=@(
  [pscustomobject]@{ ProcessId=100; ExecutablePath=$node; CommandLine="node `"$server`"" },
  [pscustomobject]@{ ProcessId=101; ExecutablePath='C:\other\node.exe'; CommandLine="node `"$server`"" },
  [pscustomobject]@{ ProcessId=102; ExecutablePath=$node; CommandLine="node `"$server.other`"" },
  [pscustomobject]@{ ProcessId=103; ExecutablePath=$node; CommandLine='node another-project.mjs' }
)
$script:listener=[pscustomobject]@{ OwningProcess=100 }; $script:stopped=@()
Stop-ImageExporter $node $server
if (($script:stopped -join ',') -ne '100') { throw 'Cleanup touched unrelated process' }
$script:listener=[pscustomobject]@{ OwningProcess=103 }; $script:stopped=@(); $rejected=$false
try { Stop-ImageExporter $node $server } catch { $rejected=$_.Exception.Message.Contains('unverified process') }
if (-not $rejected -or $script:stopped.Count) { throw 'Foreign listener was not protected' }
$script:listener=$null; $script:stopped=@()
Stop-ImageExporter $node $server
if (($script:stopped -join ',') -ne '100') { throw 'Orphan cleanup did not retain ownership checks' }
'''
        result = subprocess.run([shell, "-NoProfile", "-Command", command],
            env={**{k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"},
                 "TEST_SCRIPT": str(Path(__file__).resolve().parents[3] / "scripts/windows/Start-Lixiangqi.ps1")},
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_image_payload_copies_only_catalog_assets(self):
        shell = shutil.which("powershell.exe")
        if not shell or os.name != "nt":
            self.skipTest("Windows PowerShell release packaging")
        with tempfile.TemporaryDirectory(prefix="native image packaging ") as temporary:
            source = Path(temporary) / "source"
            release = Path(temporary) / "release"
            image = source / "tools/image_export"
            (image / "dist").mkdir(parents=True)
            for name in ("server.mjs", "renderer.mjs", "package.json"):
                (image / "dist" / name).write_text("fixture bundle")
            (image / "Dockerfile").write_text("FROM node:24-bookworm-slim")
            (source / "ui/board/src").mkdir(parents=True)
            assets = ("images/board/native.svg", "piece/native/red.svg", "piece/native/back.png", "piece/native/shadow.png")
            catalog = {"boards": [{"geometries": {"xiangqi-9x10": assets[0]}}],
                       "pieceSets": [{"variants": {"xiangqi": {"back": assets[2], "faces": {"red": {"general": assets[1]}}}}}],
                       "shadows": {"rest": assets[3]}}
            (source / "ui/board/src/catalog.json").write_text(json.dumps(catalog))
            for asset in (*assets, "unlisted.svg"):
                target = source / "public" / asset
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(asset.encode())
            command = """
$ErrorActionPreference = 'Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:TEST_SCRIPT,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($definition in $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false)) {
  . ([scriptblock]::Create($definition.Extent.Text))
}
Copy-ImageExportPayload $env:TEST_SOURCE $env:TEST_RELEASE
"""
            result = subprocess.run([shell, "-NoProfile", "-Command", command],
                env={**{k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"},
                     "TEST_SCRIPT": str(DEPLOYMENT / "push-local-live.ps1"), "TEST_SOURCE": str(source), "TEST_RELEASE": str(release)},
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            packaged = release / "runtime/image-export/public"
            self.assertEqual({p.relative_to(packaged).as_posix() for p in packaged.rglob("*") if p.is_file()}, set(assets))
            for asset in assets:
                self.assertEqual((packaged / asset).read_bytes(), (source / "public" / asset).read_bytes())


if __name__ == "__main__":
    unittest.main()
