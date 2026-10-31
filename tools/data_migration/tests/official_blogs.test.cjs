const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../20261018_official_blogs_v1.js'), 'utf8');
const clone = value => structuredClone(value);
function fixture(user = { _id: 'testing', enabled: true, roles: ['ROLE_MODERATE_BLOG'] }) {
  const collections = new Map();
  function matches(row, query) {
    return Object.entries(query).every(([key, value]) => {
      const actual = key.split('.').reduce((v, k) => v?.[k], row);
      if (value && typeof value === 'object' && '$exists' in value)
        return (actual !== undefined) === value.$exists;
      return Array.isArray(actual) ? actual.includes(value) : actual === value;
    });
  }
  function collection(name) {
    if (!collections.has(name)) {
      const rows = [];
      collections.set(name, {
        rows,
        createIndex() {},
        findOne: query => rows.find(r => matches(r, query)),
        find: query => rows.filter(r => matches(r, query)).map(clone),
        countDocuments: query => rows.filter(r => matches(r, query)).length,
        updateOne(query, update, options = {}) {
          let row = rows.find(r => matches(r, query));
          if (!row) {
            assert(options.upsert);
            row = { ...query, ...clone(update.$setOnInsert || {}) };
            rows.push(row);
          }
          Object.assign(row, clone(update.$set || {}));
          for (const [key, value] of Object.entries(update.$addToSet || {})) {
            row[key] ||= [];
            if (!row[key].includes(value)) row[key].push(value);
          }
        },
      });
    }
    return collections.get(name);
  }
  if (user) collection('user4').rows.push(clone(user));
  const run = () => vm.runInNewContext(source, { db: { getCollection: collection }, print() {} });
  return { collection, run };
}
test('grants only official publishing to testing and saves the original account', () => {
  const { collection, run } = fixture();
  run();
  assert.deepEqual(collection('user4').rows[0].roles, ['ROLE_MODERATE_BLOG', 'ROLE_PUBLISH_OFFICIAL_BLOG']);
  assert.deepEqual(collection('__official_blogs_v1_backup').rows[0].original.roles, ['ROLE_MODERATE_BLOG']);
});
test('redeployment preserves a subsequent permission revocation', () => {
  const { collection, run } = fixture();
  run();
  collection('user4').rows[0].roles = [];
  run();
  assert.deepEqual(collection('user4').rows[0].roles, []);
});
test('only former system posts are converted and backed up', () => {
  const { collection, run } = fixture();
  collection('ublog_post').rows.push(
    { _id: 'old', created: { by: 'lichess' }, live: true },
    { _id: 'personal', created: { by: 'testing' }, live: true },
    { _id: 'optout', created: { by: 'lichess' }, official: false },
  );
  run();
  assert.equal(collection('ublog_post').rows[0].official, true);
  assert.equal(collection('ublog_post').rows[1].official, undefined);
  assert.equal(collection('ublog_post').rows[2].official, false);
  assert.equal(
    collection('__official_blogs_v1_backup').findOne({ _id: 'post:old' }).original.official,
    undefined,
  );
});
test('missing, disabled, or malformed accounts fail without granting permissions', () => {
  for (const account of [null, { _id: 'testing', enabled: false }, { _id: 'testing', roles: 'bad' }]) {
    const { collection, run } = fixture(account);
    assert.throws(run);
    assert.equal(collection('__official_blogs_v1_backup').rows.length, 0);
    assert.equal(collection('__lixiangqi_migrations').rows.length, 0);
  }
});
