// Additive migration. Run against the dedicated analytics database with application writers stopped.
// No account, game or preference documents are modified. All analytics collections retain data indefinitely.
(() => {
  const hello = db.hello();
  if (!hello.setName) throw new Error('Traffic Stats requires MongoDB replica-set transactions.');
  const existing = db.getCollectionNames();
  const collections = [
    'traffic_event',
    'traffic_rollup',
    'traffic_subject_day',
    'traffic_attempt',
    'traffic_state',
    'traffic_snapshot',
    'traffic_catalog',
    'traffic_browser',
    'traffic_subject',
    'traffic_erasure',
    'traffic_rebuild',
    'traffic_game',
  ];
  for (const name of collections) {
    if (!existing.includes(name)) db.createCollection(name);
    for (const index of db.getCollection(name).getIndexes()) {
      if ('expireAfterSeconds' in index)
        throw new Error(`Retention must be indefinite: unexpected TTL index ${name}/${index.name}`);
    }
  }
  const schema = db.traffic_state.findOne({ _id: 'schema' });
  if (schema && schema.version !== 1) throw new Error(`Unexpected traffic schema ${schema.version}`);
  db.traffic_event.createIndex(
    { processed: 1, receivedAt: 1 },
    { name: 'pending', partialFilterExpression: { processed: false } },
  );
  db.traffic_event.createIndex({ subject: 1, at: 1 }, { name: 'subject_history' });
  db.traffic_event.createIndex({ at: 1 }, { name: 'rebuild_range' });
  db.traffic_event.createIndex({ month: 1, _id: 1 }, { name: 'rebuild_cursor' });
  db.traffic_rollup.createIndex({ grain: 1, dimension: 1, at: 1, registered: 1 }, { name: 'report_range' });
  db.traffic_rollup.createIndex(
    { grain: 1, dimension: 1, key: 1, at: 1, registered: 1 },
    { name: 'category_range' },
  );
  db.traffic_rollup.createIndex({ at: 1 }, { name: 'rebuild_range' });
  db.traffic_subject_day.createIndex({ day: 1 }, { name: 'rebuild_range' });
  db.traffic_erasure.createIndex({ complete: 1 }, { name: 'erasure_queue' });
  db.traffic_subject_day.createIndex({ subject: 1, day: 1 }, { name: 'subject_days', unique: true });
  db.traffic_subject_day.createIndex({ registered: 1, day: 1 }, { name: 'cohort_days' });
  db.traffic_attempt.createIndex({ 'stages.search_accepted': 1 }, { name: 'search_cohort', sparse: true });
  db.traffic_attempt.createIndex({ subject: 1 }, { name: 'subject_attempts' });
  db.traffic_snapshot.createIndex({ day: 1, dimension: 1 }, { name: 'snapshot_day' });
  db.traffic_browser.createIndex({ registered: 1, at: 1 }, { name: 'recent_browser_settings' });
  db.traffic_browser.createIndex({ subject: 1 }, { name: 'subject_browsers' });
  db.traffic_subject.createIndex({ registeredAt: 1 }, { name: 'signup_cohort', sparse: true });
  db.traffic_state.updateOne(
    { _id: 'schema' },
    { $set: { version: 1, retention: 'indefinite' }, $setOnInsert: { installedAt: new Date() } },
    { upsert: true },
  );
  for (const name of collections) {
    if (
      db
        .getCollection(name)
        .getIndexes()
        .some(index => 'expireAfterSeconds' in index)
    )
      throw new Error(`TTL verification failed: ${name}`);
  }
  print(
    JSON.stringify({
      migration: 'traffic-stats-v1',
      database: db.getName(),
      collections: collections.length,
      retention: 'indefinite',
      state: 'complete',
    }),
  );
})();
