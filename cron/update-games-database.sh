#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="${LIXIANGQI_PYTHON:-$project_root/.venv/bin/python}"

cd -- "$project_root"
exec "$python_bin" -m tools.games_database.update "$@"
