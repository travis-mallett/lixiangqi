// Additive indexes only: no accounts, ranks, or game documents are rewritten.
const indexes = [
  [
    'user_perf',
    { 'ranks.banqi.s': -1, 'ranks.banqi.la': -1, _id: 1 },
    {
      name: 'native_banqi_leaderboard',
      partialFilterExpression: { 'ranks.banqi.nb': { $gt: 0 } },
    },
  ],
  [
    'user_perf',
    { 'ranks.banqiCorrespondence.s': -1, 'ranks.banqiCorrespondence.la': -1, _id: 1 },
    {
      name: 'native_banqi_correspondence_leaderboard',
      partialFilterExpression: { 'ranks.banqiCorrespondence.nb': { $gt: 0 } },
    },
  ],
  // us and xg.states are arrays; the variant belongs in the partial filter.
  [
    'game5',
    { us: 1, ca: -1 },
    {
      name: 'native_banqi_games_by_user',
      partialFilterExpression: { 'xg.states.0.variant': 'banqi' },
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
