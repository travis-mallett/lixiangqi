// Run with mongosh against a disposable replica set from the repository root.
// Only randomly named test databases are modified; they are removed in finally.

const marker = '20261030_three_kingdoms_trial_reset';
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const oldPosition = ['TK1', ...Array(11).fill('')].join(';');
const newPosition = ['TK1', ...Array(12).fill('')].join(';');
function run(database) {
  db = database;
  load('tools/data_migration/20261030_three_kingdoms_indexes.js');
}
function fixture(name, test) {
  const database = db.getSiblingDB(`test_three_kingdoms_reset_${name}_${new ObjectId()}`);
  try {
    database.three_kingdoms_game.insertOne({
      _id: 'trial001',
      position: oldPosition,
      users: ['alice'],
      accounted: true,
      rated: true,
      winners: ['alice'],
    });
    database.user2.insertOne({
      _id: 'alice',
      count: { game: 4, rated: 2, win: 2, loss: 1, draw: 1 },
      preferences: 'keep',
    });
    database.user_perf.insertOne({ _id: 'alice', ranks: { threeKingdoms: { nb: 1 }, xiangqi: { nb: 50 } } });
    test(database);
  } finally {
    database.dropDatabase();
  }
}
fixture('success', database => {
  database.three_kingdoms_game.insertOne({ _id: 'fresh001', position: newPosition, users: ['unrelated'] });
  database.three_kingdoms_challenge.insertOne({ _id: 'pending1' });
  database.bookmark.insertMany([
    { _id: 'old', g: 'trial001' },
    { _id: 'other', g: 'other001' },
  ]);
  database.notify.insertMany([
    { _id: 'pending', content: { type: 'threeKingdomsChallenge', gameId: 'pending1' } },
    { _id: 'unrelated', content: { type: 'privateMessage' } },
  ]);
  database.tv_channel.insertOne({ _id: 'threeKingdoms', ids: ['trial001'] });
  run(database);
  check(!database.three_kingdoms_game.findOne({ _id: 'trial001' }), 'Trial game remains');
  check(database.three_kingdoms_game.findOne({ _id: 'fresh001' }), 'Fresh game removed');
  check(
    database[`${marker}_three_kingdoms_game`].findOne({ _id: 'trial001' }).position === oldPosition,
    'No recoverable game',
  );
  check(database[`${marker}_user2`].findOne({ _id: 'alice' }).count.game === 4, 'No original profile');
  const user = database.user2.findOne({ _id: 'alice' });
  check(
    user.count.game === 3 && user.count.rated === 1 && user.count.win === 1 && user.preferences === 'keep',
    'Incorrect profile adjustment',
  );
  const ranks = database.user_perf.findOne({ _id: 'alice' }).ranks;
  check(!ranks.threeKingdoms && ranks.xiangqi.nb === 50, 'Unrelated rank affected');
  check(
    database.notify.countDocuments({}) === 1 && database.bookmark.countDocuments({}) === 1,
    'Incorrect reference cleanup',
  );
  check(database.migration.findOne({ _id: marker }), 'No completion marker');
  run(database);
  check(database.user2.findOne({ _id: 'alice' }).count.game === 3, 'Repeated reset changed counters');
});
fixture('rollback', database => {
  database.three_kingdoms_game.updateOne(
    { _id: 'trial001' },
    { $set: { users: ['alice', 'bob'], losers: ['bob'] } },
  );
  database.user2.insertOne({ _id: 'bob', count: { game: 0, rated: 0, loss: 0 } });
  let failed = false;
  try {
    run(database);
  } catch {
    failed = true;
  }
  check(failed, 'Invalid counter accepted');
  check(database.user2.findOne({ _id: 'alice' }).count.game === 4, 'Transaction did not roll back');
  check(
    database.three_kingdoms_game.countDocuments({}) === 1 && !database.migration.findOne({ _id: marker }),
    'Failed reset lost data',
  );
  check(database[`${marker}_three_kingdoms_game`].countDocuments({}) === 1, 'Rollback backup missing');
});
for (const scenario of ['mismatch', 'format', 'mixed'])
  fixture(scenario, database => {
    if (scenario === 'mismatch')
      database[`${marker}_three_kingdoms_game`].insertOne({ _id: 'trial001', position: 'different' });
    if (scenario === 'format')
      database.three_kingdoms_game.updateOne({ _id: 'trial001' }, { $set: { position: 'unexpected' } });
    if (scenario === 'mixed')
      database.three_kingdoms_game.insertOne({ _id: 'fresh001', position: newPosition, users: ['alice'] });
    let failed = false;
    try {
      run(database);
    } catch {
      failed = true;
    }
    check(
      failed && database.three_kingdoms_game.findOne({ _id: 'trial001' }),
      `Unsafe ${scenario} reset proceeded`,
    );
  });
print('PASS: Three Kingdoms reset, backups, idempotence, rollback and safety guards');
