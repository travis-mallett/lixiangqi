#!/usr/bin/env bash
set -euo pipefail
root=${1:?Usage: update-player-registry.sh /absolute/deployment/root}
[[ "$root" = /* && -f "$root/compose.yaml" ]] || { echo 'Invalid deployment root' >&2; exit 1; }
exec 9>"${root}-player-registry.lock"
flock -n 9 || exit 0
cd "$root"
docker compose run --rm --no-deps -T --entrypoint python explorer \
  -m tools.games_database.player_import --apply \
  --database /app/data/local/xiangqi-games.sqlite3
