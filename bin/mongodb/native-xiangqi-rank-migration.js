// Native Xiangqi rank migration (catalog/policy v1).
//
// Run with the old application stopped and before starting the native-rank release. This script
// never modifies user4, authentication, preferences, games, puzzle Glicko, or puzzle run data.
// Chess/Glicko ratings are deliberately not translated into Xiangqi points: existing accounts
// remain unranked and begin at -160 when their first ranked 15-minute game is created.

(() => {
  const migrationId = 'native_xiangqi_rank_v1';
  const migrations = db.schema_migration;
  const existing = migrations.findOne({ _id: migrationId });
  if (existing && !['backed_up', 'complete'].includes(existing.state)) {
    throw new Error(`${migrationId} has unknown state ${existing.state}; inspect it before continuing.`);
  }

  const count = name =>
    db.getCollectionNames().includes(name) ? db.getCollection(name).countDocuments({}) : 0;

  const backup = name => {
    const backupName = `${name}_pre_native_xiangqi_v1`;
    if (!db.getCollectionNames().includes(name)) {
      if (existing?.state === 'backed_up' && existing.counts[name] !== 0) {
        throw new Error(`${name} disappeared after the migration backup checkpoint.`);
      }
      print(`Collection ${name} is absent; skipping.`);
      return { name, backupName, count: 0, skipped: true };
    }

    const sourceCount = count(name);
    const backupExists = db.getCollectionNames().includes(backupName);
    if (existing?.state === 'backed_up' && !backupExists) {
      throw new Error(`${backupName} disappeared after the migration backup checkpoint.`);
    }
    if (!existing && backupExists) {
      throw new Error(
        `${backupName} already exists without a ${migrationId} checkpoint; ` +
          'remove or rename it only after verifying why it exists.',
      );
    }
    if (!backupExists) {
      print(`Creating rollback copy: ${backupName} (${sourceCount} documents)`);
      db.getCollection(name).aggregate([{ $match: {} }, { $out: backupName }], { allowDiskUse: true });
    }

    const backupCount = count(backupName);
    if (backupCount !== sourceCount && !existing) {
      throw new Error(
        `${backupName} has ${backupCount} documents, but ${name} has ${sourceCount}; ` +
          'the backup did not complete cleanly.',
      );
    }
    if (existing?.state === 'backed_up' && backupCount !== existing.counts[name]) {
      throw new Error(`${backupName} changed after the migration backup checkpoint.`);
    }
    return { name, backupName, count: backupCount, skipped: false };
  };

  const validate = requireEmptyEphemeralState => {
    const legacyPerfDocs = db.user_perf.countDocuments({
      $or: [
        { standard: { $exists: true } },
        { ultraBullet: { $exists: true } },
        { bullet: { $exists: true } },
        { blitz: { $exists: true } },
        { rapid: { $exists: true } },
        { classical: { $exists: true } },
        { correspondence: { $exists: true } },
      ],
    });
    const legacyTournamentPlayers = db.tournament_player.countDocuments({
      $or: [
        { xr: { $exists: false } },
        { r: { $exists: true } },
        { pr: { $exists: true } },
        { e: { $exists: true } },
      ],
    });
    const legacyRankingDocs = count('ranking');
    const seekDocs = count('seek');
    const archivedSeekDocs = count('seek_archive');
    if (
      legacyPerfDocs ||
      legacyTournamentPlayers ||
      legacyRankingDocs ||
      (requireEmptyEphemeralState && (seekDocs || archivedSeekDocs))
    ) {
      throw new Error(
        `Validation failed: user_perf=${legacyPerfDocs}, tournament_player=${legacyTournamentPlayers}, ` +
          `ranking=${legacyRankingDocs}, seek=${seekDocs}, seek_archive=${archivedSeekDocs}`,
      );
    }
    print(
      `preserved puzzle performance documents: ${db.user_perf.countDocuments({ puzzle: { $exists: true } })}`,
    );
    print(
      `established native Xiangqi ranks: ${db.user_perf.countDocuments({ 'ranks.xiangqi.nb': { $gt: 0 } })}`,
    );
  };

  if (existing?.state === 'complete') {
    print(`${migrationId} is already complete; validating current state.`);
    // Seek collections are ephemeral lobby state. Native code may legitimately create new casual
    // seeks after this release, so repeat deployments validate only retired persistent schemas.
    validate(false);
    return;
  }

  if (!existing && db.getCollectionNames().includes('user4')) {
    const legacyRankedUsers = db.user4.countDocuments({ 'count.rated': { $gt: 0 } });
    if (legacyRankedUsers) {
      throw new Error(
        `${legacyRankedUsers} users have a non-zero legacy rated-game count. ` +
          'Reconcile that derived field explicitly before running the native-rank migration.',
      );
    }
  }

  const collectionNames = [
    'user_perf',
    'ranking',
    'tournament2',
    'tournament_player',
    'seek',
    'seek_archive',
  ];
  const backups = collectionNames.map(backup);

  if (!existing) {
    migrations.insertOne({
      _id: migrationId,
      state: 'backed_up',
      backedUpAt: new Date(),
      counts: Object.fromEntries(backups.map(item => [item.name, item.count])),
      backups: Object.fromEntries(backups.map(item => [item.name, item.backupName])),
    });
  }

  const legacyCompetitiveFields = {
    standard: '',
    ultraBullet: '',
    bullet: '',
    blitz: '',
    rapid: '',
    classical: '',
    correspondence: '',
    'ranks.xiangqi': '',
  };
  const perfResult = db.user_perf.updateMany({}, { $unset: legacyCompetitiveFields });
  print(`user_perf matched: ${perfResult.matchedCount}; modified: ${perfResult.modifiedCount}`);

  db.user_perf.createIndex(
    { 'ranks.xiangqi.s': -1, 'ranks.xiangqi.la': -1 },
    {
      name: 'native_xiangqi_leaderboard',
      partialFilterExpression: { 'ranks.xiangqi.nb': { $gt: 0 } },
    },
  );
  db.game5.createIndex({ us: 1, rt: 1, ca: -1 }, { name: 'native_xiangqi_games_by_user' });

  // Arena tournaments are casual, but their standings retain a native rank snapshot as a
  // tie-breaker. Existing tournament points and participation records are preserved exactly.
  const initialRank = { t: 'xiangqi', s: -160, c: '学1-3', o: 2, cv: 1, pv: 1, e: false };
  const tournamentPlayerResult = db.tournament_player.updateMany({}, [
    {
      $set: {
        xr: { $ifNull: ['$xr', initialRank] },
        m: {
          $add: [{ $multiply: [{ $ifNull: ['$s', 0] }, 100000] }, { $ifNull: ['$xr.o', initialRank.o] }],
        },
      },
    },
    { $unset: ['r', 'pr', 'e'] },
  ]);
  print(
    `tournament_player matched: ${tournamentPlayerResult.matchedCount}; ` +
      `modified: ${tournamentPlayerResult.modifiedCount}`,
  );

  db.tournament2.updateMany(
    {},
    {
      $unset: {
        mode: '',
        'conditions.nbRatedGame': '',
        'conditions.maxRating': '',
        'conditions.minRating': '',
      },
    },
  );

  // These collections are either retired projections or ephemeral lobby state. Their backups
  // make rollback possible, while clearing them prevents old schemas from entering native code.
  if (db.getCollectionNames().includes('ranking')) db.ranking.drop();
  db.seek.deleteMany({});
  db.seek_archive.deleteMany({});

  validate(true);
  migrations.updateOne({ _id: migrationId }, { $set: { state: 'complete', completedAt: new Date() } });
  print('Migration complete. user4, authentication, preferences, games, and puzzle data were not modified.');
  print('Keep all *_pre_native_xiangqi_v1 collections through the deployment rollback window.');
})();
