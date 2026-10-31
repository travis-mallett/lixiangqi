import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resetTrialStorage } from '../src/trialReset';

test('trial retirement preserves exact originals and leaves unrelated and current data intact', () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  } as Storage;
  const trial = JSON.stringify({ initial: ['TK1', ...Array(11).fill('')].join(';'), events: [] });
  const current = JSON.stringify({ initial: ['TK1', ...Array(12).fill('')].join(';') });
  entries.set('threeKingdoms.localGame', trial);
  entries.set('threeKingdoms.localHistory', current);
  entries.set('unrelated', 'unchanged');
  resetTrialStorage(storage);
  assert.equal(entries.get('threeKingdoms.trialBackup.20261030.threeKingdoms.localGame'), trial);
  assert.equal(entries.has('threeKingdoms.localGame'), false);
  assert.equal(entries.get('threeKingdoms.localHistory'), current);
  assert.equal(entries.get('unrelated'), 'unchanged');
  resetTrialStorage(storage);
  entries.set('threeKingdoms.localGame', trial.replace('events', 'other'));
  assert.throws(() => resetTrialStorage(storage), /backup differs/);
  assert.equal(entries.has('threeKingdoms.localGame'), true);
});
