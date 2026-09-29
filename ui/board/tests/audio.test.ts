import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBoardAudio, boardSoundPath, boardAssets } from '../src';

test('audio uses canonical assets, prioritizes mate, and releases each player on disposal', () => {
  const original = globalThis.Audio;
  const played: string[] = [],
    paused: string[] = [];
  class AudioStub {
    volume = 1;
    currentTime = 0;
    constructor(readonly src: string) {}
    async play() {
      played.push(this.src);
    }
    pause() {
      paused.push(this.src);
    }
    removeAttribute() {}
    load() {}
  }
  globalThis.Audio = AudioStub as unknown as typeof Audio;
  try {
    const audio = createBoardAudio(path => `/assets/${path}`);
    audio.sound({ move: true, effects: ['capture', 'check', 'checkmate'] });
    assert.deepEqual(
      played,
      [boardSoundPath('move'), boardSoundPath('checkmate'), boardAssets.sounds.checkmateEffect.path].map(
        path => `/assets/${path}`,
      ),
    );
    audio.destroy();
    assert.equal(paused.length, 3);
    audio.sound({ move: true, effects: [] });
    assert.equal(played.length, 3);
  } finally {
    globalThis.Audio = original;
  }
});
