const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../20261027_xiangqi_blog_topics.js'), 'utf8');
function fixture(posts) {
  const collections = new Map();
  const matches = (row, query) =>
    Object.entries(query).every(([key, expected]) =>
      expected?.$in
        ? expected.$in.some(v => (Array.isArray(row[key]) ? row[key].includes(v) : row[key] === v))
        : JSON.stringify(row[key]) === JSON.stringify(expected),
    );
  const collection = name => {
    if (!collections.has(name)) {
      const rows = name === 'ublog_post' ? structuredClone(posts) : [];
      collections.set(name, {
        rows,
        findOne: query => rows.find(r => matches(r, query)),
        find: query => rows.filter(r => matches(r, query)).map(r => structuredClone(r)),
        countDocuments: query => rows.filter(r => matches(r, query)).length,
        updateOne(query, update, options = {}) {
          let row = rows.find(r => matches(r, query));
          if (!row) {
            if (!options.upsert) return { matchedCount: 0 };
            row = { ...query, ...structuredClone(update.$setOnInsert || {}) };
            rows.push(row);
          }
          Object.assign(row, structuredClone(update.$set || {}));
          return { matchedCount: 1 };
        },
      });
    }
    return collections.get(name);
  };
  return {
    collection,
    run: () => vm.runInNewContext(source, { db: { getCollection: collection }, print() {} }),
  };
}

test('renames tags, deduplicates, preserves other tags and content, and retains immutable originals', () => {
  const original = {
    _id: 'post1',
    topics: ['Chess', 'Xiangqi', 'Lichess', 'Endgame'],
    markdown: 'Original content',
  };
  const f = fixture([original]);
  f.run();
  const posts = f.collection('ublog_post').rows;
  assert.deepEqual(posts[0], { ...original, topics: ['Xiangqi', 'LiXiangQi', 'Endgame'] });
  assert.deepEqual(f.collection('__xiangqi_blog_topics_v1_backup').rows[0].original, original);
  f.run();
  assert.equal(f.collection('__xiangqi_blog_topics_v1_backup').rows.length, 1);
  assert.deepEqual(f.collection('__xiangqi_blog_topics_v1_backup').rows[0].original, original);
});

test('malformed tags fail before any mutation', () => {
  const original = [
    { _id: 'valid', topics: ['Chess'] },
    { _id: 'invalid', topics: 'Chess' },
  ];
  const f = fixture(original);
  assert.throws(f.run, /Invalid topics/);
  assert.deepEqual(f.collection('ublog_post').rows, original);
  assert.equal(f.collection('__xiangqi_blog_topics_v1_backup').rows.length, 0);
});

test('interrupted updates can resume without replacing the first backup', () => {
  const original = [
    { _id: 'first', topics: ['Chess engine'] },
    { _id: 'second', topics: ['Chess bot'] },
  ];
  const f = fixture(original);
  const posts = f.collection('ublog_post');
  const update = posts.updateOne;
  posts.updateOne = (query, change, options) => {
    if (query._id === 'second') throw Error('interrupted');
    return update(query, change, options);
  };
  assert.throws(f.run, /interrupted/);
  posts.updateOne = update;
  f.run();
  assert.deepEqual(
    posts.rows.map(p => p.topics),
    [['Xiangqi engine'], ['Xiangqi bot']],
  );
  assert.deepEqual(
    f.collection('__xiangqi_blog_topics_v1_backup').rows.map(r => r.original),
    original,
  );
});
