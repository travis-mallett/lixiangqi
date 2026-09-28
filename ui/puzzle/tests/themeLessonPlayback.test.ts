import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ThemeLessonPlayback } from '../src/themeLessonPlayback.ts';

test('plays each move for one second, holds the settled mate for five seconds, and repeats', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const frames: number[] = [];
  const playback = new ThemeLessonPlayback(5, ply => frames.push(ply), 1000);
  playback.start();
  assert.deepEqual(frames, [0]);
  for (let ply = 1; ply <= 5; ply++) {
    t.mock.timers.tick(999);
    assert.equal(frames.at(-1), ply - 1);
    t.mock.timers.tick(1);
    assert.equal(frames.at(-1), ply);
  }
  t.mock.timers.tick(5999);
  assert.equal(frames.at(-1), 5);
  t.mock.timers.tick(1);
  assert.deepEqual(frames, [0, 1, 2, 3, 4, 5, 0]);
  playback.stop();
});

test('closing or pausing cancels playback and reopening restarts without duplicate timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const frames: number[] = [];
  const playback = new ThemeLessonPlayback(5, ply => frames.push(ply), 0);
  playback.start();
  t.mock.timers.tick(1000);
  playback.stop();
  t.mock.timers.tick(20000);
  assert.deepEqual(frames, [0, 1]);
  playback.resume();
  playback.resume();
  t.mock.timers.tick(1000);
  assert.deepEqual(frames, [0, 1, 2]);
  playback.start();
  t.mock.timers.tick(1000);
  assert.deepEqual(frames, [0, 1, 2, 0, 1]);
  playback.stop();
});

test('lessons with different line lengths loop independently', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shortFrames: number[] = [];
  const longFrames: number[] = [];
  const short = new ThemeLessonPlayback(3, ply => shortFrames.push(ply), 0);
  const long = new ThemeLessonPlayback(5, ply => longFrames.push(ply), 0);
  short.start();
  long.start();
  for (let second = 0; second < 8; second++) t.mock.timers.tick(1000);
  assert.deepEqual(shortFrames, [0, 1, 2, 3, 0]);
  assert.deepEqual(longFrames, [0, 1, 2, 3, 4, 5]);
  short.stop();
  t.mock.timers.tick(2000);
  assert.equal(longFrames.at(-1), 0);
  assert.deepEqual(shortFrames, [0, 1, 2, 3, 0]);
  long.stop();
});
