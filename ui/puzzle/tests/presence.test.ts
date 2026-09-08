import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { puzzlePresenceInterval, startPuzzlePresence } from '../src/presence.ts';

describe('puzzle presence', () => {
  test('announces immediately and continues on the heartbeat interval', async () => {
    let announcements = 0;
    let scheduled: (() => void) | undefined;

    startPuzzlePresence(
      async () => {
        announcements++;
      },
      (callback, delay) => {
        assert.equal(delay, puzzlePresenceInterval);
        scheduled = callback;
      },
    );

    assert.equal(announcements, 1);
    scheduled?.();
    assert.equal(announcements, 2);
  });

  test('keeps request failures from disrupting the puzzle page', async () => {
    let scheduled: (() => void) | undefined;

    startPuzzlePresence(
      () => Promise.reject(new Error('offline')),
      callback => {
        scheduled = callback;
      },
    );

    scheduled?.();
    await new Promise(resolve => setTimeout(resolve));
  });
});
