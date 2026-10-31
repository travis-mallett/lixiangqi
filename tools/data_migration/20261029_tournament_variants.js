// Run while application writers are stopped, before deploying native tournament variants.
// This only repairs unused event definitions. Events with players or games require review:
// the former form accepted a Jieqi policy but created an ordinary Xiangqi starting board.
(() => {
  const variants = new Map([
    ['jieqi-v1', 'jieqi'],
    ['minixiangqi-v1', 'minixiangqi'],
  ]);
  const tours = db.getCollection('tournament2');
  const backups = db.getCollection('__tournament_variants_v1_backup');
  const query = { gameVariant: { $exists: false }, ruleset: { $in: [...variants.keys()] } };
  const candidates = tours.find(query).toArray();
  // Validate the whole set before making any changes. Never reinterpret played games or rank snapshots.
  for (const tour of candidates) {
    if (
      tour.status !== 10 ||
      tour.nbPlayers !== 0 ||
      tour.fen ||
      db.getCollection('tournament_player').countDocuments({ tid: tour._id }) ||
      db.getCollection('tournament_pairing').countDocuments({ tid: tour._id }) ||
      db.getCollection('game5').countDocuments({ tid: tour._id })
    )
      throw new Error(
        `Legacy variant tournament ${tour._id} has participants, history or a custom position. ` +
          'Deployment stopped before migration. Review and preserve this event before proceeding; do not change played game semantics.',
      );
  }
  for (const tour of candidates) {
    backups.updateOne(
      { _id: tour._id },
      { $setOnInsert: { original: tour, savedAt: new Date() } },
      { upsert: true },
    );
    if (EJSON.stringify(backups.findOne({ _id: tour._id }).original) !== EJSON.stringify(tour))
      throw new Error(`Original backup differs for tournament ${tour._id}`);
    const gameVariant = variants.get(tour.ruleset);
    const result = tours.updateOne(
      { _id: tour._id, gameVariant: { $exists: false }, ruleset: tour.ruleset, status: 10, nbPlayers: 0 },
      { $set: { gameVariant } },
    );
    if (result.matchedCount !== 1 || tours.findOne({ _id: tour._id }).gameVariant !== gameVariant)
      throw new Error(`Tournament variant verification failed for ${tour._id}`);
  }
  if (tours.countDocuments(query)) throw new Error('Legacy tournament variant definitions remain');
  print(
    `Tournament variants verified: ${candidates.length} unused definitions repaired; originals retained.`,
  );
})();
