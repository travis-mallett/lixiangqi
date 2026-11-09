if (db.getName() !== 'lixiangqi_preview') throw Error('Disposable preview required');
const original = db.ublog_post.findOne({ _id: 'm1L9BrtK' });
const user = db.user4.findOne({ _id: 'testing123' });
if (!original || !user) throw Error('Prepared preview required');
for (const [name, tier] of [
  ['testing123', 4],
  ['bloghidden', 0],
  ['blogunlisted', 1],
]) {
  if (name !== 'testing123')
    db.user4.replaceOne(
      { _id: name },
      { ...user, _id: name, username: name, roles: [], enabled: true },
      { upsert: true },
    );
  db.ublog_blog.replaceOne({ _id: `user:${name}` }, { _id: `user:${name}`, tier }, { upsert: true });
}
for (const [id, name, live, spam] of [
  ['BlogTest', 'testing123', true, false],
  ['BlogHide', 'bloghidden', true, false],
  ['BlogDraf', 'testing123', false, false],
  ['BlogUnli', 'blogunlisted', true, false],
  ['BlogSpam', 'testing123', true, true],
]) {
  const post = {
    ...original,
    _id: id,
    blog: `user:${name}`,
    created: { ...original.created, by: name },
    official: false,
    discuss: true,
    live,
    title: 'Edition review fixture',
    intro: 'Fixture source introduction',
    markdown: 'Fixture source body for multilingual editor verification.',
    featured: undefined,
    likes: 1,
    likers: [name],
    views: 0,
    automod: { quality: spam ? 0 : 3 },
    translations: original.translations.map(t => ({
      ...t,
      published: { ...t.published, title: t.language === 'vi' ? 'Bài thử nghiệm' : '测试文章' },
    })),
  };
  delete post.featured;
  if (id === 'BlogTest') {
    const vi = post.translations.find(t => t.language === 'vi');
    vi.draft = { ...vi.published, title: 'Unpublished translation secret', markdown: 'draftsecretword' };
    delete vi.draft.publishedAt;
    delete vi.published;
  }
  db.ublog_post.replaceOne({ _id: id }, post, { upsert: true });
}
print('Prepared isolated editor, draft, hidden, unlisted and spam fixtures.');
