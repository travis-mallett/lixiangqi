// Additive indexes only: no accounts, ranks, or game documents are rewritten.
const indexes = [
  [
    'user_perf',
    { 'ranks.manchu.s': -1, 'ranks.manchu.la': -1, _id: 1 },
    {
      name: 'native_manchu_leaderboard',
      partialFilterExpression: { 'ranks.manchu.nb': { $gt: 0 } },
    },
  ],
  // us and xg.states are arrays; the variant belongs in the partial filter.
  [
    'game5',
    { us: 1, ca: -1 },
    {
      name: 'native_manchu_games_by_user',
      partialFilterExpression: { 'xg.states.0.variant': 'manchu' },
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
