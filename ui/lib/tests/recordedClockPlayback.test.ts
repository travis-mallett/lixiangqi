import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  isRecordedClockTimeline,
  RecordedClockPlayback,
  type RecordedClockFrame,
  type RecordedClockTimeline,
} from '../src/game/replay/recordedClockPlayback';

const controllers: RecordedClockPlayback[] = [];

afterEach(() => controllers.splice(0).forEach(controller => controller.destroy()));

const timeline = (): RecordedClockTimeline => ({
  startPly: 0,
  positions: [
    { white: 30_000, black: 30_000 },
    { white: 30_000, black: 30_000 },
    { white: 30_000, black: 30_000 },
  ],
  delays: [0, 0],
});

test('validates the position and delay alignment', () => {
  assert.equal(isRecordedClockTimeline(timeline()), true);
  assert.equal(isRecordedClockTimeline({ ...timeline(), delays: [0] }), false);
  assert.equal(isRecordedClockTimeline({ ...timeline(), positions: [] }), false);
  assert.equal(isRecordedClockTimeline({ ...timeline(), delays: [0, 0.5] }), false);
});

test('play at the final position rewinds and follows every recorded move', () => {
  const visited: number[] = [];
  const frames: RecordedClockFrame[] = [];
  let playing = false;
  let ended = false;
  const controller = new RecordedClockPlayback(timeline(), {
    currentPosition: () => 2,
    goToPosition: position => visited.push(position),
    renderClock: frame => frames.push(frame),
    stateChanged: value => (playing = value),
    ended: () => (ended = true),
  });
  controllers.push(controller);

  controller.start();

  assert.deepEqual(visited, [0, 1, 2]);
  assert.equal(controller.currentPosition(), 2);
  assert.equal(playing, false);
  assert.equal(ended, true);
  assert.deepEqual(frames.at(-1), { white: 300_000, black: 300_000, activeColor: undefined });
});

test('manual selection stops playback and restores an authoritative snapshot', () => {
  const value = timeline();
  value.delays = [1_000, 1_000];
  let lastFrame: RecordedClockFrame | undefined;
  const controller = new RecordedClockPlayback(value, {
    currentPosition: () => 0,
    goToPosition: () => {},
    renderClock: frame => (lastFrame = frame),
  });
  controllers.push(controller);

  controller.start();
  assert.equal(controller.isPlaying(), true);
  controller.select(1);

  assert.equal(controller.isPlaying(), false);
  assert.equal(controller.currentPosition(), 1);
  assert.deepEqual(lastFrame, { white: 300_000, black: 300_000, activeColor: undefined });
});
