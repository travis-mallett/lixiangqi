import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';

Object.defineProperty(globalThis, 'AudioContext', {
  configurable: true,
  value: class {
    state = 'running';
  },
});

const { default: sound } = await import('../src/sound');

const throttled = sound.throttled;

test('preloading and first playback share one fetch and decode; failed loads can retry', async () => {
  const fetch = globalThis.fetch;
  const ctxPromise = sound.ctxPromise;
  let requests = 0;
  let decodes = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  sound.ctxPromise = Promise.resolve({
    decodeAudioData: async (_data: ArrayBuffer) => {
      decodes++;
      return {};
    },
    createGain: () => ({ connect() {} }),
  } as unknown as AudioContext);
  globalThis.fetch = async () => {
    requests++;
    await gate;
    return new Response(new ArrayBuffer(1));
  };
  try {
    const first = sound.load('test-cue', '/test-shared-sound');
    const second = sound.load('test-cue', '/test-shared-sound');
    release();
    const loaded = await Promise.all([first, second]);
    assert.equal(loaded[0], loaded[1]);
    assert.equal(requests, 1);
    assert.equal(decodes, 1);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(sound.load('test-retry', '/test-retry-sound'));
    globalThis.fetch = async () => new Response(new ArrayBuffer(1));
    assert.ok(await sound.load('test-retry', '/test-retry-sound'));
  } finally {
    globalThis.fetch = fetch;
    sound.ctxPromise = ctxPromise;
    sound.sounds.delete('/test-shared-sound');
    sound.sounds.delete('/test-retry-sound');
    sound.paths.delete('test-cue');
    sound.paths.delete('test-retry');
  }
});

afterEach(() => {
  sound.throttled = throttled;
});

after(() => {
  sound.backgroundMusic.dispose();
});

test('explicit move metadata takes precedence over notation heuristics', async () => {
  const played: string[] = [];
  sound.throttled = name => played.push(name);

  await sound.move({ san: 'H2+3', capture: false, check: false, mate: false });

  assert.deepEqual(played, ['move']);
});

test('notation heuristics remain available when move metadata is absent', async () => {
  const played: string[] = [];
  sound.throttled = name => played.push(name);

  await sound.move({ san: 'Qxh7+' });

  assert.deepEqual(played, ['move', 'check']);
});

test('move events prioritize checkmate, then check, then capture', async () => {
  const played: string[] = [];
  sound.throttled = name => played.push(name);

  await sound.move({ capture: true, check: true, mate: true });
  await sound.move({ capture: true, check: true, mate: false });
  await sound.move({ capture: true, check: false, mate: false });

  assert.deepEqual(played, ['move', 'checkmate', 'move', 'check', 'move', 'capture']);
});

test('suppresses secondary result sounds for checkmate', async () => {
  const play = sound.play;
  const played: string[] = [];
  sound.play = async name => {
    played.push(name);
  };

  try {
    await sound.playAndDelayMateResultIfNecessary('victory');
    await sound.playAndDelayMateResultIfNecessary('defeat');
    await sound.playAndDelayMateResultIfNecessary('genericNotify');
  } finally {
    sound.play = play;
  }

  assert.deepEqual(played, []);
});

test('audio playback never finds or mutates a board', async () => {
  const soundWasEnabled = sound.isSoundEnabled();
  const board = document.createElement('div');
  board.className = 'cg-wrap xiangqi9x10';
  board.getBoundingClientRect = () => ({ width: 720, height: 800 }) as DOMRect;
  document.body.append(board);
  try {
    sound.setSoundEnabled(false);
    for (const event of ['capture', 'check', 'checkmate']) await sound.play(event);
    assert.equal(board.children.length, 0);
  } finally {
    board.remove();
    sound.setSoundEnabled(soundWasEnabled);
  }
});

test('disabling board animations does not disable checkmate audio', async () => {
  const soundWasEnabled = sound.isSoundEnabled();
  const soundSet = sound.soundSet;
  const load = sound.load;
  const resumeWithTest = sound.resumeWithTest;
  const visibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  const board = document.createElement('div');
  const played: string[] = [];

  board.className = 'cg-wrap xiangqi9x10';
  board.getBoundingClientRect = () => ({ width: 720, height: 800 }) as DOMRect;
  document.body.append(board);
  document.body.dataset.boardAnimations = '0';
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  sound.load = async name =>
    ({
      play: async () => {
        played.push(name);
      },
    }) as never;
  sound.resumeWithTest = async () => true;

  try {
    sound.setSoundEnabled(true);
    sound.changeSoundSet('standard');
    await sound.play('checkmate');

    assert.deepEqual(played, ['checkmate', 'checkmateAnimationEffect']);
    assert.equal(board.querySelector('.xiangqi-board-animation'), null);
  } finally {
    sound.load = load;
    sound.resumeWithTest = resumeWithTest;
    if (visibilityState) Object.defineProperty(document, 'visibilityState', visibilityState);
    else delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    delete document.body.dataset.boardAnimations;
    board.remove();
    sound.setSoundEnabled(soundWasEnabled);
    sound.changeSoundSet(soundSet);
  }
});

test('voice setting only suppresses capture, check, and spoken checkmate effects', async () => {
  const soundWasEnabled = sound.isSoundEnabled();
  const voiceWasEnabled = sound.isVoiceSoundEnabled();
  const soundSet = sound.soundSet;
  const load = sound.load;
  const resumeWithTest = sound.resumeWithTest;
  const visibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  const loaded: string[] = [];
  const played: string[] = [];

  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  sound.load = async name => {
    loaded.push(name);
    return { play: async () => played.push(name) } as never;
  };
  sound.resumeWithTest = async () => true;

  try {
    sound.setSoundEnabled(true);
    sound.setVoiceSoundEnabled(false);
    sound.changeSoundSet('standard');

    await sound.play('capture');
    await sound.play('check');
    await sound.play('genericNotify');
    await sound.play('checkmate');

    assert.deepEqual(loaded, ['genericNotify', 'checkmateAnimationEffect']);
    assert.deepEqual(played, ['genericNotify', 'checkmateAnimationEffect']);
  } finally {
    sound.load = load;
    sound.resumeWithTest = resumeWithTest;
    if (visibilityState) Object.defineProperty(document, 'visibilityState', visibilityState);
    else delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    sound.setSoundEnabled(soundWasEnabled);
    sound.setVoiceSoundEnabled(voiceWasEnabled);
    sound.changeSoundSet(soundSet);
  }
});

test('starts both checkmate sounds without waiting for a rendering frame', async () => {
  const soundWasEnabled = sound.isSoundEnabled();
  const soundSet = sound.soundSet;
  const load = sound.load;
  const resumeWithTest = sound.resumeWithTest;
  const requestAnimationFrame = window.requestAnimationFrame;
  const visibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  const board = document.createElement('div');
  const loaded: { name: string; path?: string }[] = [];
  const started: { name: string; volume: number; synchronized: boolean }[] = [];
  let insideAnimationFrame = false;

  board.className = 'cg-wrap xiangqi9x10';
  board.getBoundingClientRect = () => ({ width: 720, height: 800 }) as DOMRect;
  document.body.append(board);
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  window.requestAnimationFrame = callback => {
    insideAnimationFrame = true;
    callback(0);
    insideAnimationFrame = false;
    return 1;
  };
  sound.load = async (name, path) => {
    loaded.push({ name, path });
    return {
      play: async (volume: number) => {
        started.push({
          name,
          volume,
          synchronized: insideAnimationFrame,
        });
      },
    } as never;
  };
  sound.resumeWithTest = async () => true;

  try {
    sound.setSoundEnabled(true);
    sound.changeSoundSet('standard');
    await sound.play('checkmate', 0.5);

    assert.deepEqual(loaded, [
      { name: 'checkmate', path: undefined },
      {
        name: 'checkmateAnimationEffect',
        path: '/assets/sound/standard/Checkmate_sound_effect.mp3',
      },
    ]);
    assert.deepEqual(
      started.map(({ name, synchronized }) => ({ name, synchronized })),
      [
        { name: 'checkmate', synchronized: false },
        { name: 'checkmateAnimationEffect', synchronized: false },
      ],
    );
    assert.equal(started[1].volume, started[0].volume * 0.8);
  } finally {
    sound.load = load;
    sound.resumeWithTest = resumeWithTest;
    window.requestAnimationFrame = requestAnimationFrame;
    if (visibilityState) Object.defineProperty(document, 'visibilityState', visibilityState);
    else delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    board.remove();
    sound.setSoundEnabled(soundWasEnabled);
    sound.changeSoundSet(soundSet);
  }
});
