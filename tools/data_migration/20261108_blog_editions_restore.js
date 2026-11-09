// Recovery only, with writers stopped. First copy the affected current documents
// into a new recovery generation, then restore the immutable pre-migration copies.
// Set globalThis.blogEditionRestoreAcknowledged = true explicitly before loading.
(() => {
  if (globalThis.blogEditionRestoreAcknowledged !== true)
    throw Error('Explicit recovery acknowledgement required');
  const posts = db.getCollection('ublog_post');
  const originals = db.getCollection('__blog_editions_v1_backup');
  const recovery = db.getCollection('__blog_editions_v1_restore_backup');
  const generation = new ObjectId().toString();
  let restored = 0;
  originals.find({}).forEach(saved => {
    if (!saved.original || saved._id !== saved.original._id)
      throw Error(`Invalid original backup: ${saved._id}`);
  });
  originals.find({}).forEach(saved => {
    const current = posts.findOne({ _id: saved._id });
    recovery.insertOne({ generation, postId: saved._id, original: current, savedAt: new Date() });
    if (!recovery.findOne({ generation, postId: saved._id }))
      throw Error(`Recovery backup failed: ${saved._id}`);
  });
  originals.find({}).forEach(saved => {
    posts.replaceOne({ _id: saved._id }, saved.original, { upsert: true });
    if (EJSON.stringify(posts.findOne({ _id: saved._id })) !== EJSON.stringify(saved.original))
      throw Error(`Restoration verification failed: ${saved._id}`);
    restored++;
  });
  if (posts.getIndexes().some(i => i.name === 'blog_editions_text_v1'))
    posts.dropIndex('blog_editions_text_v1');
  db.getCollection('__lixiangqi_migrations').deleteMany({ _id: /^blog-edition(?:s-v1$|-v1:)/ });
  print(
    `Restored ${restored} original articles; pre-restoration content retained in ${recovery.getName()}, generation ${generation}.`,
  );
})();
