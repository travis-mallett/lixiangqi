// One-time migration from the former Google Sheet-managed video documents.
// Run with application writers stopped. The deployment tool backs up and can
// restore the video namespace before invoking this script.

(() => {
  const migrationId = 'video_library_v1';
  const migrations = db.schema_migration;
  const existing = migrations.findOne({ _id: migrationId });
  if (existing?.state === 'complete') {
    print('Video library migration is already complete.');
    return;
  }
  if (existing) {
    throw new Error(`${migrationId} has unknown state ${existing.state}; inspect it before continuing.`);
  }

  const videoExists = db.getCollectionNames().includes('video');
  if (videoExists) {
    const textIndex = db.video.getIndexes().find(index => Object.values(index.key).includes('text'));
    if (textIndex) db.video.dropIndex(textIndex.name);

    let sortOrder = 0;
    db.video
      .find({})
      .sort({ 'metadata.refreshedAt': -1, createdAt: -1 })
      .forEach(video => {
        const set = {};
        if (!video.source)
          set.source = {
            provider: 'youtube',
            externalId: video._id,
            canonicalUrl: `https://www.youtube.com/watch?v=${video._id}`,
          };
        if (!video.status) set.status = 'published';
        set.sortOrder = NumberInt(Number.isInteger(video.sortOrder) ? video.sortOrder : sortOrder);
        if (!video.updatedAt) set.updatedAt = video.createdAt || new Date();
        if (video.metadata && typeof video.metadata.available !== 'boolean') set['metadata.available'] = true;
        db.video.updateOne({ _id: video._id }, { $set: set });
        sortOrder += 10;
      });
  }

  db.video.createIndex(
    { 'source.provider': 1, 'source.externalId': 1 },
    { unique: true, partialFilterExpression: { 'source.externalId': { $exists: true } } },
  );
  db.video.createIndex({ status: 1, sortOrder: 1, createdAt: -1 });
  db.video.createIndex({ status: 1, tags: 1, sortOrder: 1 });
  db.video.createIndex({ status: 1, author: 1, sortOrder: 1 });
  db.video.createIndex({ status: 1, 'metadata.refreshedAt': 1 });
  db.video.createIndex(
    { title: 'text', author: 'text', description: 'text', tags: 'text' },
    { weights: { title: 10, tags: 5, author: 3, description: 1 }, default_language: 'english' },
  );

  const incomplete = db.video.countDocuments({
    $or: [
      { source: { $exists: false } },
      { 'source.provider': { $nin: ['youtube', 'bilibili'] } },
      { 'source.externalId': { $exists: false } },
      { 'source.canonicalUrl': { $exists: false } },
      { status: { $exists: false } },
      { status: { $nin: ['draft', 'published', 'archived'] } },
      { updatedAt: { $exists: false } },
      { metadata: { $type: 'object' }, 'metadata.available': { $exists: false } },
    ],
  });
  const invalidSortOrder = db.video.countDocuments({
    $expr: { $ne: [{ $type: '$sortOrder' }, 'int'] },
  });
  if (incomplete || invalidSortOrder) {
    throw new Error(
      `Video library validation failed: incomplete=${incomplete}, sortOrder=${invalidSortOrder}`,
    );
  }

  migrations.insertOne({ _id: migrationId, state: 'complete', completedAt: new Date() });
  print(`Video library migration complete: ${db.video.countDocuments({})} videos.`);
})();
