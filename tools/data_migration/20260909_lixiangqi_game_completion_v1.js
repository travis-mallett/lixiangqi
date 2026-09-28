/* Backfill completion metadata, retaining a recoverable copy for every attempt. */
// Must match game.collection.game in conf/base.conf (covered by the tests).
const collection = 'game5';
const games = db.getCollection(collection);
const marker = db.getCollection('__lixiangqi_migrations');
// Keep any old game2 migration marker and backup as recovery evidence.
const id = collection + '-completion-v1';
const existing = marker.findOne({ _id: id });
if (existing && !existing.appliedAt) throw new Error('unknown game completion migration marker state');
if (existing && (!existing.backup || !db.getCollectionNames().includes(existing.backup)))
  throw new Error('completed game migration backup is missing: ' + existing.backup);
const eligible = games.countDocuments({ s: { $gte: 30 }, co: { $exists: false } });
const total = games.countDocuments({});
const finished = games.countDocuments({ s: { $gte: 30 } });
print(JSON.stringify({ collection, total, finished, missingCompletion: eligible }));
if (eligible === 0) {
  games.createIndex({ co: 1, _id: 1 }, { name: 'completedAt_id' });
  print(JSON.stringify({ collection, alreadyApplied: !!existing, backfilled: 0 }));
} else {
  const backupName = '__lixiangqi_game_completion_backup_' + new ObjectId().toHexString();
  games.aggregate([{ $match: { s: { $gte: 30 }, co: { $exists: false } } }, { $out: backupName }]).toArray();
  const backup = db.getCollection(backupName);
  if (backup.countDocuments({}) !== eligible) throw new Error('completion backup count mismatch');
  const missingDate = backup.countDocuments({
    ua: { $not: { $type: 'date' } },
    ca: { $not: { $type: 'date' } },
  });
  if (missingDate !== 0)
    throw new Error('finished games have no recoverable completion date: ' + missingDate);
  backup.find({}, { _id: 1, ua: 1, ca: 1 }).forEach(game => {
    const completion = game.ua instanceof Date ? game.ua : game.ca;
    const result = games.updateOne(
      { _id: game._id, s: { $gte: 30 }, co: { $exists: false } },
      { $set: { co: completion } },
    );
    if (result.matchedCount !== 1) throw new Error('game changed during completion backfill: ' + game._id);
  });
  if (games.countDocuments({ s: { $gte: 30 }, co: { $exists: false } }) !== 0)
    throw new Error('completion backfill incomplete');
  backup.find({}, { _id: 1, ua: 1, ca: 1 }).forEach(game => {
    const completion = game.ua instanceof Date ? game.ua : game.ca;
    const actual = games.findOne({ _id: game._id });
    if (!(actual.co instanceof Date) || actual.co.getTime() !== completion.getTime())
      throw new Error('completion verification failed: ' + game._id);
  });
  games.createIndex({ co: 1, _id: 1 }, { name: 'completedAt_id' });
  marker.replaceOne(
    { _id: id },
    { _id: id, collection, backup: backupName, appliedAt: new Date() },
    { upsert: true },
  );
  print(JSON.stringify({ collection, backup: backupName, backfilled: eligible }));
}
