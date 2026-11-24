#!/bin/sh
# Called from the release directory under the deployment writer gate.
set -eu
umask 077

mongo() { docker compose exec -T mongo mongosh --quiet lichess "$@"; }
replay() {
  docker compose run --rm -T --no-deps --entrypoint java lila -cp '/lila/lib/*' \
    lila.app.mashup.CorrespondenceRankMigration "$1" mongodb://mongo:27017/lichess lichess
}
state() {
  mongo --eval "print(db.schema_migration.findOne({_id:'correspondence_ranks_v1'})?.state ?? 'missing')"
}

# Fill only missing live chart days. Each point is a recorded observation:
# a game-start snapshot, a confirmed settlement, or the current account.
live_history() {
  mongo --eval "$(cat <<'MONGO'
const marker = "live_profile_history_v1";
if (db.schema_migration.findOne({_id: marker})) quit(0);
const tracks = ["xiangqi", "jieqi", "minixiangqi", "manchu", "threeKingdoms"];
let written = 0;
const accounts = db.user_perf.find({$or: tracks.map(t => ({["ranks."+t+".nb"]: {$gt:0}}))},
                                  {ranks:1,rankHistory:1});
while (accounts.hasNext()) {
  const u = accounts.next();
  for (const t of tracks) {
    const perf = u.ranks[t];
    if (!perf || !perf.nb) continue;
    const days = new Map(), ends = new Map();
    const observe = (at, score, preferTie = false) => {
      if (!(at instanceof Date) || !Number.isInteger(score)) throw Error("Invalid live rank observation for "+u._id);
      const day = at.toISOString().slice(0,10);
      if (!days.has(day) || days.get(day).at < at || (preferTie && +days.get(day).at === +at)) days.set(day,{at,score});
    };
    if (t === "threeKingdoms") {
      const games = db.three_kingdoms_game.find({users:u._id,rated:true,"clock.config.days":{$exists:false}},
                {seats:1,createdAt:1,movedAt:1,finished:1});
      while (games.hasNext()) {
        const g = games.next();
        const rk = g.seats.find(s => s.userId === u._id)?.rank;
        if (!rk || rk.correspondence) continue;
        if (rk.established) observe(g.createdAt,rk.score);
        if (g.finished && Number.isInteger(rk.diff)) ends.set(g._id,{at:g.movedAt,d:rk.diff});
      }
    } else {
      const games = db.game5.find({us:u._id,rt:t,cd:{$exists:false}},
                                    {us:1,ca:1,co:1,ua:1,"p0.rk":1,"p1.rk":1});
      while (games.hasNext()) {
        const g = games.next();
        const rk = g["p"+g.us.indexOf(u._id)]?.rk;
        if (!rk || rk.t !== t) continue;
        if (rk.e) observe(g.ca,rk.s);
        if (Number.isInteger(rk.d)) ends.set(g._id,{at:g.co || g.ua,d:rk.d});
      }
    }
    // Receipts are newest first and contain the actual delta after score clamping.
    // A refund has no settlement timestamp, so use only independently dated snapshots.
    if (!perf.rf?.length) {
      let score = perf.s;
      for (const receipt of perf.st || []) {
        const end = ends.get(receipt.g);
        if (!end || end.d !== receipt.d || !(end.at instanceof Date)) break;
        observe(end.at,score);
        score -= receipt.d;
      }
    }
    observe(perf.rf?.length ? new Date() : (perf.la || new Date()),perf.s,true);
    const additions = {};
    for (const [day,point] of days) {
      if (u.rankHistory?.[t]?.[day] === undefined) additions["rankHistory."+t+"."+day]=point.score;
    }
    if (Object.keys(additions).length) {
      const guard = Object.fromEntries(Object.keys(additions).map(key=>[key,{$exists:false}]));
      if (db.user_perf.updateOne({_id:u._id,...guard},{$set:additions}).matchedCount !== 1) throw Error("Concurrent chart write");
      if (!db.user_perf.findOne({_id:u._id,...additions},{_id:1})) throw Error("Live history verification failed");
      written += Object.keys(additions).length;
    }
  }
}
db.schema_migration.insertOne({_id:marker,days:written,at:new Date()});
print("Added "+written+" historical live rank days");
MONGO
)"
}

mongo --eval '
for (const v of ["xiangqi","minixiangqi","jieqi","manchu","threeKingdoms"]) {
  const prefix = "ranks." + v + "Correspondence.";
  db.user_perf.createIndex({[prefix+"s"]:-1,[prefix+"la"]:-1,_id:1},{
    name:"correspondence_"+v,partialFilterExpression:{[prefix+"nb"]:{$gt:0}}
  });
}'
case "$(state)" in
  complete) live_history; echo 'Correspondence rank migration already complete'; exit 0 ;;
  missing) ;;
  *) echo 'Unexpected correspondence migration state' >&2; exit 1 ;;
esac
replay preview
backup=$(mktemp -d "${PWD}-correspondence-ranks-v1.XXXXXXXX")
touch "$backup/collections-absent-before-replay.txt"
for collection in game5 three_kingdoms_game user_perf user4 schema_migration; do
  case "$(mongo --eval "print(db.getCollectionInfos({name:'$collection'}).length)")" in
    0) echo "$collection" >> "$backup/collections-absent-before-replay.txt"; continue ;;
    1) ;;
    *) echo "Cannot verify collection $collection" >&2; exit 1 ;;
  esac
  docker compose exec -T mongo mongodump --quiet --db lichess --collection "$collection" \
    --archive --gzip > "$backup/$collection.archive.gz"
  gzip -t "$backup/$collection.archive.gz"
done
(cd "$backup" && sha256sum ./*.archive.gz collections-absent-before-replay.txt > SHA256SUMS && sha256sum -c SHA256SUMS)
echo "Verified pre-replay recovery archives in $backup"
# Recovery must keep the new writers after this point, even if the client loses the commit reply.
touch "${PWD}-correspondence-ranks-v1.pending"
replay apply
test "$(state)" = complete
live_history
