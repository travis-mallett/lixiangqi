// Run with application writers stopped. Recover originals from __xiangqi_blog_topics_v1_backup.
(() => {
  const id = 'xiangqi-blog-topics-v1';
  const topics = new Map([
    ['Chess', 'Xiangqi'],
    ['Chess engine', 'Xiangqi engine'],
    ['Chess bot', 'Xiangqi bot'],
    ['Chess Personalities', 'Xiangqi Personalities'],
    ['Chess variant', 'Xiangqi variant'],
    ['Lichess', 'LiXiangQi'],
  ]);
  const posts = db.getCollection('ublog_post');
  const backups = db.getCollection('__xiangqi_blog_topics_v1_backup');
  const migrations = db.getCollection('__lixiangqi_migrations');
  const query = { topics: { $in: [...topics.keys()] } };
  // Validate every candidate before making any changes.
  posts.find(query).forEach(post => {
    if (!Array.isArray(post.topics) || post.topics.some(topic => typeof topic !== 'string'))
      throw new Error(`Invalid topics on blog post ${post._id}; no topics changed.`);
  });
  let converted = 0;
  posts.find(query).forEach(post => {
    backups.updateOne(
      { _id: post._id },
      { $setOnInsert: { source: 'ublog_post', original: post, savedAt: new Date() } },
      { upsert: true },
    );
    if (!backups.findOne({ _id: post._id })) throw new Error(`Backup missing for ${post._id}`);
    const renamed = [...new Set(post.topics.map(topic => topics.get(topic) ?? topic))];
    const result = posts.updateOne({ _id: post._id, topics: post.topics }, { $set: { topics: renamed } });
    if (result.matchedCount !== 1) throw new Error(`Blog post ${post._id} changed during migration.`);
    if (JSON.stringify(posts.findOne({ _id: post._id }).topics) !== JSON.stringify(renamed))
      throw new Error(`Topic verification failed for ${post._id}`);
    converted++;
  });
  if (posts.countDocuments(query)) throw new Error('Legacy blog topics remain.');
  migrations.updateOne(
    { _id: id },
    { $set: { state: 'complete', completedAt: new Date(), converted } },
    { upsert: true },
  );
  print(`Xiangqi blog topics ready: ${converted} posts converted; originals retained.`);
})();
