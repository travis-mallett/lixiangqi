#!/usr/bin/env bash
# Run under the deployment data lock. Never stop or write to live services.
set -euo pipefail
staging=$1
snapshot_id=$2
origin=$3
clone="lixiangqi-snapshot-$snapshot_id"
cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    echo "Production snapshot capture failed (exit $status)" >&2
    docker inspect --format '{{json .State}}' "$clone" >&2 || true
    docker logs --tail 20 "$clone" >&2 || true
  fi
  if ! docker rm -fv "$clone" >/dev/null 2>&1 && [ "$status" -eq 0 ]; then
    echo "Failed to remove temporary snapshot container $clone" >&2
    exit 1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo 'Checking production MongoDB snapshot prerequisites'
docker compose exec -T mongo mongosh --quiet --eval '
const h = db.hello();
if (!h.setName || !h.isWritablePrimary)
  throw new Error("Online preview snapshots require a writable replica-set primary. Run the updated deployment first; live services have not been stopped.");
'
# --oplog requires a full dump, not --db or namespace filtering. A rollover
# or unsupported concurrent DDL makes mongodump fail, leaving no manifest.
echo 'Capturing production MongoDB with its oplog'
docker compose exec -T mongo mongodump --oplog --numParallelCollections=1 \
  --gzip --archive > "$staging/online.archive.gz"
test -s "$staging/online.archive.gz"

# Match the running server exactly. No published port, production mount, or
# network: replay can only write into this disposable container's own volume.
mongo_id=$(docker compose ps -q mongo)
image=$(docker inspect --format '{{.Image}}' "$mongo_id")

echo 'Starting isolated snapshot MongoDB'
docker run -d --name "$clone" --network none --memory 1g --cpus 1 "$image" \
  mongod --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 0.25 \
  --setParameter ttlMonitorEnabled=false >/dev/null
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$clone" mongosh --quiet --eval 'db.adminCommand({ping:1})' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
"$ready" || { echo 'Snapshot MongoDB did not become ready' >&2; exit 1; }
echo 'Restoring the captured data into isolated snapshot MongoDB'
docker exec -i "$clone" mongorestore --stopOnError --oplogReplay \
  --gzip --archive < "$staging/online.archive.gz"

# Both derived exports and the preview archive now read the same frozen copy.
# TTL must remain disabled so expired records cannot disappear between reads.
echo 'Exporting native games and published puzzle inventory'
docker cp "$staging/export_snapshot.js" "$clone:/tmp/export_snapshot.js"
docker exec -e "SNAPSHOT_ORIGIN=$origin" "$clone" mongosh lichess --quiet --eval \
  'require("/tmp/export_snapshot.js").exportSnapshot(db,"/tmp/export",process.env.SNAPSHOT_ORIGIN)' \
  >/dev/null
docker cp "$clone:/tmp/export/native-games.jsonl" "$staging/native-games.jsonl"
docker cp "$clone:/tmp/export/puzzle-inventory.json" "$staging/puzzle-inventory.json"
echo 'Exporting the verified preview archive'
docker exec "$clone" mongodump --db lichess --numParallelCollections=1 \
  --gzip --archive > "$staging/mongo.archive.gz"
test -s "$staging/mongo.archive.gz"
rm -- "$staging/online.archive.gz"
