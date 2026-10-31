// Additive indexes only; no user, rank, or game documents are rewritten.
const indexes = [
  [
    'user_perf',
    { 'ranks.minixiangqi.s': -1, 'ranks.minixiangqi.la': -1, _id: 1 },
    {
      name: 'native_minixiangqi_leaderboard',
      partialFilterExpression: { 'ranks.minixiangqi.nb': { $gt: 0 } },
    },
  ],
  // us and xg.states are both arrays: keep the variant in the partial filter.
  [
    'game5',
    { us: 1, ca: -1 },
    {
      name: 'native_minixiangqi_games_by_user',
      partialFilterExpression: { 'xg.states.0.variant': 'minixiangqi' },
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
    JSON.stringify(actual.partialFilterExpression) !== JSON.stringify(options.partialFilterExpression)
  )
    throw new Error(`Unexpected index definition: ${options.name}`);
  print(`Verified ${collection}.${options.name}`);
}
