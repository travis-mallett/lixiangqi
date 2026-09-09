import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';

import { stopXiangqiBoardAnimation } from 'lib/xiangqiBoardAnimation';

Object.defineProperty(globalThis, 'AudioContext', {
  configurable: true,
  value: class {
    state = 'running';
  },
});

const { default: sound } = await import('../src/sound');

const throttled = sound.throttled;

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

test('move-event playback launches Xiangqi board animations independently of audio settings', async () => {
  const soundWasEnabled = sound.isSoundEnabled();
  const board = document.createElement('div');
  board.className = 'cg-wrap xiangqi9x10';
  board.getBoundingClientRect = () => ({ width: 720, height: 800 }) as DOMRect;
  document.body.append(board);
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });

  try {
    sound.setSoundEnabled(false);
    await sound.play('capture');
    const capture = board.querySelector<HTMLImageElement>('.xiangqi-board-animation__image');
    assert.ok(capture);
    assert.match(capture.src, /board-animations\/lixiangqi-default\/capture\/animation\.webp/);

    await sound.play('check');
    const check = board.querySelector<HTMLImageElement>('.xiangqi-board-animation__image');
    assert.ok(check);
    assert.match(check.src, /board-animations\/lixiangqi-default\/check\/animation\.webp/);
    assert.equal(board.querySelectorAll('.xiangqi-board-animation').length, 1);

    await sound.play('checkmate');
    const checkmate = board.querySelector<HTMLImageElement>('.xiangqi-board-animation__image');
    assert.ok(checkmate);
    assert.match(checkmate.src, /board-animations\/lixiangqi-default\/checkmate\/animation\.webp/);
    assert.equal(board.querySelectorAll('.xiangqi-board-animation').length, 1);
  } finally {
    stopXiangqiBoardAnimation(board);
    board.remove();
    sound.setSoundEnabled(soundWasEnabled);
  }
});

test('move-event playback targets an explicitly selected Xiangqi board', async () => {
  const soundWasEnabled = sound.isSoundEnabled();
  const throttled = sound.throttled;
  const first = document.createElement('div');
  const selected = document.createElement('div');
  first.className = selected.className = 'cg-wrap xiangqi9x10';
  document.body.append(first, selected);
  Object.assign(site, { asset: { url: (path: string) => `/assets/${path}` } });

  try {
    sound.setSoundEnabled(false);
    sound.throttled = (name, volume, board) => void sound.play(name, volume, board);
    const eventFlags = {
      capture: { capture: true },
      check: { check: true },
      checkmate: { mate: true },
    } as const;
    for (const event of ['capture', 'check', 'checkmate'] as const) {
      await sound.move({ ...eventFlags[event], board: selected });
      assert.equal(first.querySelector('.xiangqi-board-animation'), null);
      assert.ok(selected.querySelector(`.xiangqi-board-animation--${event}`));
    }
  } finally {
    sound.throttled = throttled;
    stopXiangqiBoardAnimation(first);
    stopXiangqiBoardAnimation(selected);
    first.remove();
    selected.remove();
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

test('starts the checkmate animation and dedicated effect together', async () => {
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
        const image = board.querySelector<HTMLImageElement>('.xiangqi-board-animation__image');
        started.push({
          name,
          volume,
          synchronized:
            insideAnimationFrame &&
            image?.src.includes('/board-animations/lixiangqi-default/checkmate/animation.webp') === true,
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
        { name: 'checkmate', synchronized: true },
        { name: 'checkmateAnimationEffect', synchronized: true },
      ],
    );
    assert.equal(started[1].volume, started[0].volume * 0.8);
  } finally {
    sound.load = load;
    sound.resumeWithTest = resumeWithTest;
    window.requestAnimationFrame = requestAnimationFrame;
    if (visibilityState) Object.defineProperty(document, 'visibilityState', visibilityState);
    else delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    stopXiangqiBoardAnimation(board);
    board.remove();
    sound.setSoundEnabled(soundWasEnabled);
    sound.changeSoundSet(soundSet);
  }
});
