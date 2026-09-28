import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../20260925_supported_puzzle_objectives.js', import.meta.url), 'utf8');
function harness() {
  const original = { _id: 'old', playback: { objective: 'abandoned' }, plays: 47, vote: 3 };
  const puzzles = new Map([
    ['old', original],
    ['keep', { _id: 'keep', playback: { objective: 'tactic' }, plays: 28 }],
  ]);
  const backup = new Map();
  let interrupt = false;
  let pending = false;
  const matches = p => !['mate', 'tactic'].includes(p.playback.objective);
  const context = {
    db: {
      puzzle2_publication: { findOne: () => (pending ? { operation: 'pending' } : null) },
      puzzle2_puzzle: {
        find: () => [...puzzles.values()].filter(matches),
        countDocuments: () => [...puzzles.values()].filter(matches).length,
        deleteOne: ({ _id }) => {
          if (interrupt) throw new Error('interrupted');
          puzzles.delete(_id);
        },
      },
      getCollection: () => ({
        findOne: ({ _id }) => backup.get(_id),
        insertOne: doc => backup.set(doc._id, structuredClone(doc)),
      }),
    },
    EJSON: JSON,
    print: () => {},
  };
  return {
    puzzles,
    backup,
    original,
    run: () => runInNewContext(source, context),
    interrupt: value => (interrupt = value),
    pending: value => (pending = value),
  };
}

test('archives complete originals before deletion, resumes and leaves supported puzzles intact', () => {
  const h = harness();
  h.interrupt(true);
  assert.throws(h.run, /interrupted/);
  assert.deepEqual(h.backup.get('old'), h.original);
  assert.equal(h.puzzles.size, 2);
  h.interrupt(false);
  h.run();
  h.run();
  assert.deepEqual([...h.puzzles.keys()], ['keep']);
  assert.equal(h.puzzles.get('keep').plays, 28);
  assert.deepEqual(h.backup.get('old'), h.original);
});

test('stops before changes when publication is pending or recovery data differs', () => {
  const h = harness();
  h.pending(true);
  assert.throws(h.run, /Recover pending/);
  assert.equal(h.backup.size, 0);
  h.pending(false);
  h.backup.set('old', { ...h.original, plays: 1 });
  assert.throws(h.run, /differs/);
  assert.equal(h.puzzles.size, 2);
});
