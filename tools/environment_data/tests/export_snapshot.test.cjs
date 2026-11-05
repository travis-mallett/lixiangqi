const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { exportSnapshot } = require('../export_snapshot.js');

function cursor(rows) {
  const iterator = rows[Symbol.iterator]();
  let next = iterator.next();
  return {
    sort() {
      return this;
    },
    batchSize(size) {
      assert.equal(size, 100);
      return this;
    },
    async hasNext() {
      return !next.done;
    },
    async next() {
      const value = next.value;
      next = iterator.next();
      return value;
    },
  };
}

function database(puzzles, games = []) {
  return {
    getCollection(name) {
      return {
        async findOne() {
          return name === 'puzzle2_publication' ? { version: 'version"1' } : games[0];
        },
        async find() {
          return cursor(name === 'game5' ? games : puzzles);
        },
      };
    },
  };
}

function puzzle(id, sourceSnapshot = { initialFen: 'fen', moves: [], players: [] }) {
  return {
    _id: id,
    gameId: 'game0001',
    gameSource: { type: 'catalog', database: 'masters' },
    fen: 'fen',
    line: 'a1a2 a9a8',
    themes: ['mate'],
    sourceSnapshot,
  };
}

if (process.argv[2] === '--memory-fixture') {
  const rows = {
    *[Symbol.iterator]() {
      for (let i = 0; i < 4000; i++)
        yield puzzle(String(i), { initialFen: 'fen', moves: Array(2000).fill('a1a2'), players: [] });
    },
  };
  exportSnapshot(database(rows), process.argv[3], 'https://example.org').catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const { test } = require('node:test');

  test('native exports retain persisted rulesets and historical unrestricted defaults', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-export-'));
    try {
      const games = ['unrestricted-v1', 'tiantian-v1'].map((ruleset, index) => ({
        _id: `game000${index}`,
        xv: 1,
        co: new Date(1234),
        us: [],
        xg: { initialFen: 'fen', moves: [], ...(index ? { ruleset } : {}) },
      }));
      const output = path.join(root, 'export');
      await exportSnapshot(database([], games), output, 'https://example.org');
      const exported = fs
        .readFileSync(path.join(output, 'native-games.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.deepEqual(
        exported.map(game => game.ruleset),
        ['unrestricted-v1', 'tiantian-v1'],
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('streamed inventory preserves content, revision keys and missing-source membership', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-export-'));
    try {
      const rows = [
        puzzle('a"1'),
        { ...puzzle('b'), authorRevision: 'r1', managedThemes: ['new'] },
        puzzle('c', null),
      ];
      const output = path.join(root, 'export');
      const counts = await exportSnapshot(database(rows), output, 'https://example.org');
      const inventory = JSON.parse(fs.readFileSync(path.join(output, 'puzzle-inventory.json')));
      assert.deepEqual(counts, { nativeGames: 0, puzzles: 3, pendingSources: 1 });
      assert.equal(inventory.schemaVersion, 2);
      assert.deepEqual(
        inventory.puzzles,
        rows.map(p => ({
          _id: p._id,
          gameId: p.gameId,
          gameSource: p.gameSource,
          fen: p.fen,
          line: p.line,
          themes: p.managedThemes || p.themes,
          retired: false,
          retirementReason: null,
          sourceSnapshot: p.sourceSnapshot,
        })),
      );
      assert.deepEqual(inventory.pendingSources, ['c']);
      assert.deepEqual(inventory.publication, {
        version: 'version"1',
        revisions: { 'a"1': null, b: 'r1', c: null },
      });
      assert.deepEqual(fs.readdirSync(output).sort(), ['native-games.jsonl', 'puzzle-inventory.json']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('empty streamed inventory is valid JSON', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-export-'));
    try {
      const output = path.join(root, 'export');
      await exportSnapshot(database([]), output, 'https://example.org');
      const inventory = JSON.parse(fs.readFileSync(path.join(output, 'puzzle-inventory.json')));
      assert.deepEqual(inventory.puzzles, []);
      assert.deepEqual(inventory.pendingSources, []);
      assert.deepEqual(inventory.publication.revisions, {});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('inventory larger than the available JS heap exports without retaining the corpus', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-export-'));
    try {
      const output = path.join(root, 'export');
      const result = spawnSync(
        process.execPath,
        ['--max-old-space-size=32', __filename, '--memory-fixture', output],
        { encoding: 'utf8', timeout: 60000 },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.statSync(path.join(output, 'puzzle-inventory.json')).size > 32 * 1024 * 1024);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
