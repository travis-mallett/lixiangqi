/* Completion backfill must use the application's game collection and preserve source data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../20260909_lixiangqi_game_completion_v1.js'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, '../../../conf/base.conf'), 'utf8');
const configuredCollection = config.match(/\ngame\s*\{\s*collection\s*\{\s*game\s*=\s*(\w+)/)[1];
assert.equal(script.match(/const collection = '(\w+)'/)[1], configuredCollection);

function matches(doc, query) {
  return Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, operand]) => {
        if (operator === '$gte') return doc[key] >= operand;
        if (operator === '$exists') return (doc[key] !== undefined) === operand;
        if (operator === '$not') return !matches(doc, { [key]: operand });
        if (operator === '$type') return operand === 'date' && doc[key] instanceof Date;
        throw new Error('unsupported operator: ' + operator);
      });
    }
    return doc[key] === value;
  });
}
function database(initial = {}) {
  const data = structuredClone(initial);
  const indexes = [];
  const api = {
    data,
    indexes,
    getCollectionNames: () => Object.keys(data),
    getCollection(name) {
      const rows = () => data[name] || [];
      return {
        countDocuments: query => rows().filter(row => matches(row, query)).length,
        findOne: query => structuredClone(rows().find(row => matches(row, query))),
        find: query => ({
          forEach: fn =>
            rows()
              .filter(row => matches(row, query))
              .map(row => structuredClone(row))
              .forEach(fn),
        }),
        aggregate(pipeline) {
          data[pipeline[1].$out] = structuredClone(rows().filter(row => matches(row, pipeline[0].$match)));
          return { toArray: () => [] };
        },
        updateOne(query, update) {
          const row = rows().find(row => matches(row, query));
          if (row) Object.assign(row, structuredClone(update.$set));
          return { matchedCount: row ? 1 : 0 };
        },
        replaceOne(query, replacement) {
          data[name] = rows().filter(row => !matches(row, query));
          data[name].push(structuredClone(replacement));
        },
        createIndex: spec => indexes.push({ name, spec }),
      };
    },
  };
  return api;
}
let nextId = 0;
function run(db) {
  const output = [];
  vm.runInNewContext(script, {
    db,
    Date,
    print: value => output.push(JSON.parse(value)),
    ObjectId: class {
      toHexString() {
        return String(++nextId);
      }
    },
  });
  return output;
}
const created = new Date('2026-01-01T00:00:00Z');
const moved = new Date('2026-01-01T01:00:00Z');
const records = [
  { _id: 'finished', s: 30, ca: created, ua: moved, xg: { moves: ['a4a5'] }, us: ['one', 'two'] },
  { _id: 'fallback', s: 31, ca: created },
  { _id: 'existing', s: 35, ca: created, ua: moved, co: created },
  { _id: 'playing', s: 20, ca: created },
  { _id: 'aborted', s: 25, ca: created },
];
const db = database({ game5: records, game2: [{ _id: 'unrelated', s: 30, ca: created }] });
const output = run(db);
assert.deepEqual(output[0], { collection: 'game5', total: 5, finished: 3, missingCompletion: 2 });
assert.equal(output[1].backfilled, 2);
assert.deepEqual(
  db.data.game5,
  records.map(row => ({
    ...row,
    ...(['finished', 'fallback'].includes(row._id) ? { co: row.ua || row.ca } : {}),
  })),
);
assert.deepEqual(db.data.game2, [{ _id: 'unrelated', s: 30, ca: created }]);
assert.deepEqual(db.data[output[1].backup], records.slice(0, 2));
assert.equal(db.indexes[0].name, 'game5');
const before = structuredClone(db.data);
assert.equal(run(db)[1].backfilled, 0);
assert.deepEqual(db.data, before);

// A prior erroneous game2 no-op marker must not suppress the real backfill.
const old = database({
  game5: [records[0]],
  __lixiangqi_migrations: [{ _id: 'game-completion-v1', appliedAt: created, backup: 'old_backup' }],
  old_backup: [],
});
assert.equal(run(old)[1].backfilled, 1);
assert.equal(old.data.__lixiangqi_migrations.length, 2);
assert.deepEqual(old.data.old_backup, []);

// Bad historical records fail before altering games, retaining recovery evidence.
const bad = database({ game5: [{ _id: 'bad', s: 30, ca: 'invalid' }, records[0]] });
const originals = structuredClone(bad.data.game5);
assert.throws(() => run(bad), /no recoverable completion date/);
assert.deepEqual(bad.data.game5, originals);
assert.deepEqual(
  bad.data[Object.keys(bad.data).find(name => name.startsWith('__lixiangqi_game_completion_backup_'))],
  originals,
);

const missingBackup = database({
  game5: [],
  __lixiangqi_migrations: [{ _id: 'game5-completion-v1', appliedAt: created, backup: 'missing' }],
});
assert.throws(() => run(missingBackup), /backup is missing/);
assert.equal(run(database())[1].backfilled, 0);
console.log('Game completion migration tests passed.');
