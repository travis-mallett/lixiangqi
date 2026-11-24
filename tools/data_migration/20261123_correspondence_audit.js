// Read-only. The game records distinguish correspondence with a deadline from unlimited games.
const groups = (collection, match, key) =>
  collection.aggregate([{ $match: match }, { $group: { _id: key, games: { $sum: 1 } } }]).toArray();
printjson({
  database: db.getName(),
  duelGames: db.game5.estimatedDocumentCount(),
  duels: groups(
    db.game5,
    { c: { $exists: false } },
    {
      days: { $ifNull: ['$cd', 0] },
      rules: '$xg.ruleset',
      source: '$so',
      status: '$s',
      rated: { $ifNull: ['$ra', false] },
      track: { $ifNull: ['$rt', null] },
      members: { $size: { $filter: { input: { $ifNull: ['$us', []] }, cond: { $ne: ['$$this', ''] } } } },
    },
  ),
  kingdoms: groups(
    db.three_kingdoms_game,
    { 'clock.config.initialSeconds': 0 },
    {
      days: '$clock.config.days',
      source: '$source',
      rated: '$rated',
      finished: '$finished',
      hasComputer: {
        $gt: [{ $size: { $filter: { input: '$seats', cond: { $gt: ['$$this.aiLevel', 0] } } } }, 0],
      },
    },
  ),
  legacyAccounts: db.user_perf_pre_native_xiangqi_v1.countDocuments({ 'correspondence.nb': { $gt: 0 } }),
});
