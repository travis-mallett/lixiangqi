// Deployment runs this file while application writers are stopped.
// One-time trial reset: preserve complete originals, then atomically remove the
// superseded trial games and reverse only their accounted profile contributions.
// This entry point is already packaged and executed by push-local-live.
(() => {
  const marker = '20261030_three_kingdoms_trial_reset';
  if (db.migration.findOne({ _id: marker })) return;
  const games = db.three_kingdoms_game.find({}).toArray();
  const old = games.filter(g => typeof g.position === 'string' && g.position.split(';').length === 12);
  if (games.some(g => typeof g.position !== 'string' || ![12, 13].includes(g.position.split(';').length)))
    throw new Error('Unexpected Three Kingdoms game format; reset aborted.');
  if (old.length > 2000 || old.some(g => g.tournamentId))
    throw new Error('Trial reset assumptions failed: too many games or tournament games.');
  const ids = old.map(g => g._id);
  const users = [...new Set(old.flatMap(g => g.users || []))];
  if (games.some(g => !ids.includes(g._id) && (g.users || []).some(u => users.includes(u))))
    throw new Error('Old and new games share players; automatic trial accounting reset is unsafe.');
  const selections = [
    ['three_kingdoms_game', { _id: { $in: ids } }],
    ['three_kingdoms_challenge', {}],
    ['bookmark', { g: { $in: ids } }],
    ['notify', { 'content.type': 'threeKingdomsChallenge' }],
    ['tv_channel', { _id: 'threeKingdoms' }],
    ['user2', { _id: { $in: users } }],
    ['user_perf', { _id: { $in: users } }],
  ];
  const snapshots = selections.map(([name, query]) => [name, db.getCollection(name).find(query).toArray()]);
  // MongoDB can reorder fields during an upsert. Compare BSON values, including
  // numeric/date types, without mistaking field order for a failed backup.
  const canonical = value =>
    JSON.stringify(EJSON.serialize(value, { relaxed: false }), (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
        : item,
    );
  for (const [name, documents] of snapshots) {
    const backup = db.getCollection(`${marker}_${name}`);
    for (const doc of documents) {
      backup.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
      if (canonical(backup.findOne({ _id: doc._id })) !== canonical(doc))
        throw new Error(`Backup differs from current ${name}/${doc._id}; inspect before rerunning.`);
    }
    print(`Trial reset: verified ${documents.length} originals from ${name}`);
  }
  const session = db.getMongo().startSession();
  const target = session.getDatabase(db.getName());
  try {
    session.startTransaction();
    for (const user of users) {
      const inc = {};
      for (const g of old.filter(g => g.accounted && (g.users || []).includes(user))) {
        const add = key => {
          inc[key] = (inc[key] || 0) - 1;
        };
        add('count.game');
        if (g.rated) add('count.rated');
        add(
          (g.winners || []).includes(user)
            ? 'count.win'
            : (g.losers || []).includes(user)
              ? 'count.loss'
              : 'count.draw',
        );
      }
      const original = target.user2.findOne({ _id: user });
      if (original && Object.keys(inc).length) {
        for (const [key, delta] of Object.entries(inc))
          if ((original.count?.[key.split('.')[1]] || 0) + delta < 0)
            throw new Error(`Invalid counter for ${user}: ${key}`);
        target.user2.updateOne({ _id: user }, { $inc: inc });
      }
      target.user_perf.updateOne({ _id: user }, { $unset: { 'ranks.threeKingdoms': '' } });
    }
    for (const [name, query] of selections.slice(0, 5)) target.getCollection(name).deleteMany(query);
    if (target.three_kingdoms_game.countDocuments({ _id: { $in: ids } }))
      throw new Error('Trial games remain.');
    target.migration.insertOne({
      _id: marker,
      completedAt: new Date(),
      games: ids.length,
      backups: snapshots.map(([name]) => `${marker}_${name}`),
    });
    session.commitTransaction();
  } catch (error) {
    session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
  print(`Three Kingdoms trial reset complete: ${ids.length} games; recoverable originals retained.`);
})();

// Idempotent indexes for the canonical ruleset.
const indexes = [
  [
    'three_kingdoms_game',
    { unattendedDuel: 1, movedAt: 1 },
    { name: 'unattended_duels', partialFilterExpression: { unattendedDuel: true } },
  ],
  ['three_kingdoms_game', { users: 1, createdAt: -1, _id: -1 }, { name: 'history_by_user' }],
  ['three_kingdoms_game', { createdAt: -1, _id: -1 }, { name: 'history' }],
  [
    'three_kingdoms_game',
    { deadline: 1 },
    { name: 'active_deadlines', partialFilterExpression: { finished: false } },
  ],
  [
    'three_kingdoms_game',
    { users: 1, createdAt: -1 },
    { name: 'playing_by_user', partialFilterExpression: { finished: false } },
  ],
  ['three_kingdoms_game', { playingUsers: 1 }, { name: 'playing_users' }],
  [
    'three_kingdoms_game',
    { users: 1, movedAt: -1 },
    { name: 'completed_activity', partialFilterExpression: { finished: true } },
  ],
  ['three_kingdoms_game', { movedAt: -1 }, { name: 'live', partialFilterExpression: { finished: false } }],
  [
    'three_kingdoms_game',
    { movedAt: 1 },
    { name: 'unsettled', partialFilterExpression: { finished: true, settled: false } },
  ],
  [
    'three_kingdoms_game',
    { tournamentId: 1, createdAt: -1 },
    { name: 'tournament', partialFilterExpression: { tournamentId: { $type: 'string' } } },
  ],
  [
    'three_kingdoms_game',
    { tournamentId: 1, users: 1, movedAt: 1 },
    { name: 'tournament_scores', partialFilterExpression: { tournamentId: { $type: 'string' } } },
  ],
  [
    'three_kingdoms_game',
    { tournamentId: 1, finished: 1, tournamentRecorded: 1 },
    { name: 'tournament_recovery', partialFilterExpression: { tournamentId: { $type: 'string' } } },
  ],
  ['three_kingdoms_challenge', { users: 1, status: 1, expiresAt: -1 }, { name: 'invitations' }],
  ['three_kingdoms_challenge', { status: 1 }, { name: 'recover_acceptance' }],
  [
    'three_kingdoms_challenge',
    { notifyPending: 1, status: 1, expiresAt: 1 },
    { name: 'notification_outbox' },
  ],
  ['three_kingdoms_challenge', { expiresAt: 1 }, { name: 'expiry', expireAfterSeconds: 86400 }],
  [
    'user_perf',
    { 'ranks.threeKingdoms.s': -1, 'ranks.threeKingdoms.la': -1, _id: 1 },
    {
      name: 'native_three_kingdoms_leaderboard',
      partialFilterExpression: { 'ranks.threeKingdoms.nb': { $gt: 0 } },
    },
  ],
];
for (const [collection, key, options] of indexes) {
  const coll = db.getCollection(collection);
  coll.createIndex(key, options);
  const actual = coll.getIndexes().find(index => index.name === options.name);
  if (
    !actual ||
    JSON.stringify(actual.key) !== JSON.stringify(key) ||
    JSON.stringify(actual.partialFilterExpression) !== JSON.stringify(options.partialFilterExpression) ||
    actual.expireAfterSeconds !== options.expireAfterSeconds
  )
    throw new Error(`Unexpected index definition: ${collection}.${options.name}`);
  print(`Verified ${collection}.${options.name}`);
}
