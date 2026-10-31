// Index changes only: existing games, rank accounts and settings are unchanged.
// Missing Jieqi rank accounts use the domain's zero-point initial account until first settlement.
db.user_perf.createIndex(
  { 'ranks.jieqi.s': -1, 'ranks.jieqi.la': -1 },
  { name: 'native_jieqi_leaderboard', partialFilterExpression: { 'ranks.jieqi.nb': { $gt: 0 } } },
);
// Both us and xg.states are arrays. Filter on the variant without indexing the states array.
db.game5.createIndex(
  { us: 1, ca: -1 },
  {
    name: 'native_jieqi_games_by_user',
    partialFilterExpression: { 'xg.states.0.variant': 'jieqi' },
  },
);

// An empty database could have accepted the old index, which would then reject ordinary game writes.
const obsolete = db.game5.getIndexes().find(index => index.name === 'native_variant_games_by_user');
if (obsolete) {
  if (
    JSON.stringify(obsolete.key) !== JSON.stringify({ us: 1, 'xg.states.0.variant': 1, ca: -1 }) ||
    obsolete.unique ||
    obsolete.sparse ||
    obsolete.partialFilterExpression
  )
    throw new Error('Unexpected definition for obsolete native_variant_games_by_user index');
  db.game5.dropIndex(obsolete.name);
}
for (const [collection, name] of [
  ['user_perf', 'native_jieqi_leaderboard'],
  ['game5', 'native_jieqi_games_by_user'],
]) {
  if (
    !db
      .getCollection(collection)
      .getIndexes()
      .some(index => index.name === name)
  )
    throw new Error(`Missing index ${name}`);
}
print('Jieqi indexes verified; no existing user or game documents modified.');
