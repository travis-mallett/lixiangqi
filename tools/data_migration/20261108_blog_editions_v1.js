// Run with application writers stopped. The release packager prepends reviewed
// official content; this file alone initializes the edition schema and search index.
(() => {
  const posts = db.getCollection('ublog_post');
  const backups = db.getCollection('__blog_editions_v1_backup');
  const migrations = db.getCollection('__lixiangqi_migrations');
  const release = globalThis.blogEditionRelease || [];
  const digest = value =>
    require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const normalize = language => {
    const l = language.toLowerCase();
    if (['zh', 'zh-cn', 'zh-sg', 'zh-hans'].includes(l)) return 'zh-Hans';
    if (l.startsWith('vi-')) return 'vi';
    if (l.startsWith('en-')) return 'en';
    return language;
  };
  const revision = p =>
    digest([
      normalize(p.language),
      p.title,
      p.intro,
      p.markdown,
      p.image?.id ?? null,
      p.image?.alt ?? null,
      p.image?.credit ?? null,
    ]);
  const content = item => ({
    title: item.title,
    intro: item.intro,
    markdown: item.markdown,
    sourceRevision: item.sourceRevision,
    translator: item.translator,
    reviewer: item.reviewer,
    ...(item.imageAlt ? { imageAlt: item.imageAlt } : {}),
    ...(item.imageCredit ? { imageCredit: item.imageCredit } : {}),
  });
  const markerFor = item => `blog-edition-v1:${item.id}:${item.language}`;
  // Match UblogSearch.cjkTerms. Boundaries prevent phrases crossing separate runs.
  const cjkTerms = item =>
    ([item.title, item.intro, item.markdown].join('\n').match(/[\p{Script=Han}]+/gu) || [])
      .map(run => {
        const chars = [...run];
        return [...chars, 'cjkboundary', ...chars.slice(1).map((c, i) => chars[i] + c), 'cjkboundary'].join(
          ' ',
        );
      })
      .join(' ') || '';
  const backup = post => {
    backups.updateOne(
      { _id: post._id },
      { $setOnInsert: { original: post, savedAt: new Date() } },
      { upsert: true },
    );
    const saved = backups.findOne({ _id: post._id });
    if (!saved?.original || saved.original._id !== post._id)
      throw Error(`Backup verification failed: ${post._id}`);
  };

  // Preflight every document and payload before changing any post. Completed
  // releases are immutable and never overwrite subsequent editorial revisions.
  posts.find({}).forEach(post => {
    if (
      typeof post.title !== 'string' ||
      typeof post.intro !== 'string' ||
      typeof post.markdown !== 'string' ||
      typeof post.language !== 'string' ||
      !post.created?.by
    )
      throw Error(`Unexpected post schema: ${post._id}`);
    if (
      post.translations !== undefined &&
      (!Array.isArray(post.translations) ||
        new Set(post.translations.map(t => t.language)).size !== post.translations.length)
    )
      throw Error(`Invalid translation collection: ${post._id}`);
  });
  const seen = new Set();
  for (const item of release) {
    const marker = markerFor(item);
    if (seen.has(marker)) throw Error(`Duplicate release edition: ${marker}`);
    seen.add(marker);
    if (!['en', 'zh-Hans', 'vi'].includes(item.language) || item.language === normalize(item.sourceLanguage))
      throw Error(`Invalid translation language: ${marker}`);
    if (
      !item.title ||
      !item.intro ||
      !item.markdown ||
      !item.translator ||
      !item.reviewer ||
      item.reviewed !== true
    )
      throw Error(`Unreviewed or incomplete translation: ${marker}`);
    const completed = migrations.findOne({ _id: marker, state: 'complete' });
    if (completed) {
      if (completed.contentHash !== digest(content(item)))
        throw Error(`Completed release content changed: ${marker}`);
      continue;
    }
    const post = posts.findOne({ _id: item.id });
    if (!post?.official || !post.live || normalize(post.language) !== item.sourceLanguage)
      throw Error(`Expected an existing published official source: ${item.id}`);
    if (revision(post) !== item.sourceRevision) throw Error(`Source changed: ${item.id}`);
    const existing = (post.translations || []).find(t => t.language === item.language);
    // Resume a crash after the atomic post write but before its receipt. Never
    // replace another draft or an independently edited publication.
    if (
      existing &&
      (existing.draft ||
        !existing.published ||
        digest(content(existing.published)) !== digest(content(item)) ||
        !existing.published.reviewed ||
        !existing.published.publishedAt ||
        !backups.findOne({ _id: item.id })?.original)
    )
      throw Error(`Existing edition requires editorial review, not replacement: ${marker}`);
  }

  // Back up all source documents before the first mutation. Mongo's document
  // atomicity makes each write independently resumable; originals never change.
  posts
    .find({ $or: [{ translations: { $exists: false } }, { searchCjk: { $exists: false } }] })
    .forEach(backup);
  for (const item of release) {
    if (!migrations.findOne({ _id: markerFor(item), state: 'complete' }))
      backup(posts.findOne({ _id: item.id }));
  }
  const initialized = posts.updateMany(
    { translations: { $exists: false } },
    { $set: { translations: [] } },
  ).modifiedCount;
  if (posts.countDocuments({ translations: { $exists: false } })) throw Error('Incomplete schema migration');
  posts.find({ searchCjk: { $exists: false } }).forEach(post => {
    posts.updateOne({ _id: post._id }, { $set: { searchCjk: cjkTerms(post) } });
  });

  // Avoid interpreting BCP-47 source languages as Mongo stemmer names. Only
  // published content enters this index; drafts never become search results.
  posts.createIndex(
    {
      title: 'text',
      intro: 'text',
      markdown: 'text',
      searchCjk: 'text',
      'translations.published.title': 'text',
      'translations.published.intro': 'text',
      'translations.published.markdown': 'text',
      'translations.published.searchCjk': 'text',
    },
    {
      name: 'blog_editions_text_v1',
      default_language: 'none',
      language_override: 'textSearchLanguage',
    },
  );
  let published = 0;
  for (const item of release) {
    const marker = markerFor(item);
    if (migrations.findOne({ _id: marker, state: 'complete' })) continue;
    const post = posts.findOne({ _id: item.id });
    if (!post.translations.some(t => t.language === item.language)) {
      const at = new Date();
      const edition = {
        ...content(item),
        searchCjk: cjkTerms(item),
        updated: { by: post.created.by, at },
        reviewed: { by: post.created.by, at },
        publishedAt: at,
      };
      const result = posts.updateOne(
        { _id: item.id, 'translations.language': { $ne: item.language } },
        { $push: { translations: { language: item.language, published: edition } } },
      );
      if (result.modifiedCount !== 1) throw Error(`Publication failed: ${marker}`);
      published++;
    }
    const saved = posts.findOne({ _id: item.id }).translations.find(t => t.language === item.language);
    if (digest(content(saved.published)) !== digest(content(item)))
      throw Error(`Publication verification failed: ${marker}`);
    migrations.updateOne(
      { _id: marker },
      {
        $set: {
          state: 'complete',
          completedAt: new Date(),
          sourceRevision: item.sourceRevision,
          contentHash: digest(content(item)),
        },
      },
      { upsert: true },
    );
  }
  migrations.updateOne(
    { _id: 'blog-editions-v1' },
    { $set: { state: 'complete', completedAt: new Date() } },
    { upsert: true },
  );
  print(
    `Blog editions: initialized ${initialized} articles; published ${published} translations. Originals retained in ${backups.getName()}.`,
  );
})();
