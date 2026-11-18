// Run with application writers stopped. Restart only with the recurring scheduler removed.
// Original documents are retained for recovery; never overwrite them on retry.
(() => {
  const tours = db.getCollection('tournament2');
  const recurring = {
    $or: [
      {
        'schedule.freq': {
          $in: [
            'hourly',
            'daily',
            'eastern',
            'weekly',
            'weekend',
            'monthly',
            'shield',
            'marathon',
            'experimentalmarathon',
            'yearly',
          ],
        },
      },
      { 'schedule.freq': 'unique', name: /^\d{4} Lixiangqi Anniversary$/ },
    ],
  };
  const candidates = tours.find({ ...recurring, status: { $in: [10, 20] } }).toArray();
  function save(collection, document) {
    const backup = db.getCollection('__retired_recurring_v1_' + collection);
    const result = backup.updateOne(
      { _id: document._id },
      { $setOnInsert: { original: document, savedAt: new Date() } },
      { upsert: true },
    );
    const saved = backup.findOne({ _id: document._id })?.original;
    if (!saved || (result.upsertedCount && EJSON.stringify(saved) !== EJSON.stringify(document)))
      throw new Error('Missing recovery copy: ' + collection + '/' + document._id);
  }
  // Validate before mutation. A created event must never contain played history.
  for (const tour of candidates) {
    if (
      tour.status === 10 &&
      (db.tournament_pairing.countDocuments({ tid: tour._id }) ||
        db.game5.countDocuments({ tid: tour._id }) ||
        db.three_kingdoms_game.countDocuments({ tournamentId: tour._id }))
    )
      throw new Error('Created recurring tournament has game history: ' + tour._id);
    save('tournament2', tour);
    for (const name of ['tournament_player', 'tournament_pairing', 'game5'])
      db.getCollection(name)
        .find({ tid: tour._id })
        .forEach(doc => save(name, doc));
    db.three_kingdoms_game.find({ tournamentId: tour._id }).forEach(doc => save('three_kingdoms_game', doc));
  }
  let removed = 0;
  let ending = 0;
  for (const tour of candidates) {
    if (tour.status === 10) {
      db.tournament_player.deleteMany({ tid: tour._id });
      const result = tours.deleteOne({ _id: tour._id, status: 10 });
      if (result.deletedCount !== 1) throw new Error('Failed removing ' + tour._id);
      removed++;
    } else {
      // The existing organizer closes pairings and uses TournamentApi.finish to repair
      // games, recompute standings and publish results. Do not bypass that lifecycle.
      if (!tour.scoreCutoff)
        tours.updateOne({ _id: tour._id, status: 20 }, { $set: { scoreCutoff: new Date() } });
      if (!tours.findOne({ _id: tour._id }).scoreCutoff) throw new Error('Failed closing ' + tour._id);
      ending++;
    }
  }
  if (tours.countDocuments({ ...recurring, status: 10 })) throw new Error('Upcoming recurring events remain');
  print(
    `Recurring tournaments retired: ${removed} upcoming removed; ${ending} underway closed for normal finalization on restart. Backups retained; completed history unchanged.`,
  );
})();
