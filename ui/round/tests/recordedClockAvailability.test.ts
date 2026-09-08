import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { canToggleRecordedClockPlayback } from '../src/util';

describe('TV recorded clock playback availability', () => {
  const data = (tv: boolean, spectator: boolean) =>
    ({ tv: tv ? {} : undefined, player: { spectator } }) as any;
  const playback = (delayCount: number) => ({ timeline: { delays: Array(delayCount) } }) as any;

  it('is available at the latest position when timing exists', () => {
    assert.equal(canToggleRecordedClockPlayback(data(true, true), playback(3)), true);
  });

  it('requires a TV spectator and nonempty timing data', () => {
    assert.equal(canToggleRecordedClockPlayback(data(true, true), playback(0)), false);
    assert.equal(canToggleRecordedClockPlayback(data(false, true), playback(3)), false);
    assert.equal(canToggleRecordedClockPlayback(data(true, false), playback(3)), false);
    assert.equal(canToggleRecordedClockPlayback(data(true, true), undefined), false);
  });
});
