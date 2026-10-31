// Run with application writers stopped. This additive migration keeps recoverable originals.
(() => {
  const id = 'official-blogs-v1';
  const migrations = db.getCollection('__lixiangqi_migrations');
  const users = db.getCollection('user4');
  const posts = db.getCollection('ublog_post');
  const backups = db.getCollection('__official_blogs_v1_backup');
  const role = 'ROLE_PUBLISH_OFFICIAL_BLOG';

  posts.createIndex({ official: 1, live: 1, 'lived.at': -1 }, { name: 'official_published' });
  if (migrations.findOne({ _id: id, state: 'complete' })) {
    print('Official blogs already provisioned; preserving subsequent permission changes.');
    return;
  }

  const user = users.findOne({ _id: 'testing' });
  if (!user || user.enabled === false)
    throw new Error('Official blog provisioning requires the existing enabled testing account.');
  if (user.roles !== undefined && !Array.isArray(user.roles))
    throw new Error('Unexpected testing account roles; no permissions changed.');

  backups.updateOne(
    { _id: 'user:testing' },
    { $setOnInsert: { source: 'user4', original: user, savedAt: new Date() } },
    { upsert: true },
  );
  users.updateOne({ _id: user._id }, { $addToSet: { roles: role } });
  if (!users.findOne({ _id: user._id, roles: role }))
    throw new Error('Official blog permission grant failed verification.');

  // Convert any existing system-account posts once. Runtime uses only the explicit flag.
  let converted = 0;
  posts.find({ 'created.by': 'lichess', official: { $exists: false } }).forEach(post => {
    backups.updateOne(
      { _id: `post:${post._id}` },
      { $setOnInsert: { source: 'ublog_post', original: post, savedAt: new Date() } },
      { upsert: true },
    );
    posts.updateOne({ _id: post._id }, { $set: { official: true } });
    converted++;
  });
  if (posts.countDocuments({ 'created.by': 'lichess', official: { $exists: false } }))
    throw new Error('Official post migration did not finish.');
  migrations.updateOne(
    { _id: id },
    { $set: { state: 'complete', completedAt: new Date(), converted } },
    { upsert: true },
  );
  print(`Official blogs ready; testing can publish. Converted ${converted} system-account posts.`);
})();
