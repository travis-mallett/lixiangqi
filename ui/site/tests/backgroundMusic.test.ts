import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  BackgroundMusic,
  type BackgroundMusicEnvironment,
  type BackgroundMusicRequest,
} from '../src/backgroundMusic';

const request: BackgroundMusicRequest = {
  name: 'wuxia3',
  url: '/assets/sound/wuxia3/Music.mp3',
  volume: 0.25,
};

class FakeAudio extends EventTarget {
  readonly HAVE_METADATA = 1;
  currentTime = 0;
  duration = 100;
  loop = false;
  paused = true;
  preload = '';
  readyState = this.HAVE_METADATA;
  src: string;
  volume = 1;
  playCount = 0;
  pauseCount = 0;

  constructor(url: string) {
    super();
    this.src = url;
  }

  load(): void {}

  pause(): void {
    this.paused = true;
    this.pauseCount++;
  }

  play(): Promise<void> {
    this.paused = false;
    this.playCount++;
    return Promise.resolve();
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
}

class FakeLockManager {
  private held = false;

  request(
    _name: string,
    _options: LockOptions,
    callback: (lock: Lock | null) => Promise<void> | void,
  ): Promise<void> {
    if (this.held) return Promise.resolve(callback(null));
    this.held = true;
    return Promise.resolve(callback({} as Lock)).finally(() => {
      this.held = false;
    });
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class MusicDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

const players: BackgroundMusic[] = [];
let visibility: DocumentVisibilityState;

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  players.splice(0).forEach(player => player.dispose());
});

function makePlayer(
  locks: FakeLockManager | undefined,
  audios: FakeAudio[],
  now: () => number = Date.now,
  storage: Storage = sessionStorage,
  musicDocument: Document = document,
): BackgroundMusic {
  const environment: BackgroundMusicEnvironment = {
    window,
    document: musicDocument,
    storage,
    sharedStorage: localStorage,
    locks: locks as unknown as LockManager | undefined,
    createAudio: url => {
      const audio = new FakeAudio(url);
      audios.push(audio);
      return audio as unknown as HTMLAudioElement;
    },
    now,
  };
  const player = new BackgroundMusic(environment);
  players.push(player);
  return player;
}

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

describe('BackgroundMusic', () => {
  test('allows only one tab to create and play music', async () => {
    const locks = new FakeLockManager();
    const firstAudio: FakeAudio[] = [];
    const secondAudio: FakeAudio[] = [];
    const first = makePlayer(locks, firstAudio, Date.now, new MemoryStorage());
    const second = makePlayer(locks, secondAudio, Date.now, new MemoryStorage());

    first.sync(request);
    second.sync(request);
    await nextTask();

    assert.equal(firstAudio.length, 1);
    assert.equal(firstAudio[0].playCount, 1);
    assert.equal(secondAudio.length, 0);
  });

  test('takes over immediately from a stale hidden-tab ownership record', async () => {
    localStorage.setItem(
      'sound.background-music.owner',
      JSON.stringify({
        tabId: 'hidden-tab',
        instanceId: 'hidden-instance',
        status: 'hidden',
        updatedAt: Date.now(),
      }),
    );
    const audio: FakeAudio[] = [];
    const player = makePlayer(new FakeLockManager(), audio);

    player.sync(request);
    await nextTask();

    assert.equal(audio.length, 1);
    assert.equal(audio[0].playCount, 1);
  });

  test('never lets a hidden tab claim music ownership', async () => {
    const locks = new FakeLockManager();
    const hiddenDocument = new MusicDocument();
    const visibleDocument = new MusicDocument();
    hiddenDocument.visibilityState = 'hidden';
    const hiddenAudio: FakeAudio[] = [];
    const visibleAudio: FakeAudio[] = [];
    const hidden = makePlayer(
      locks,
      hiddenAudio,
      Date.now,
      new MemoryStorage(),
      hiddenDocument as unknown as Document,
    );
    const visible = makePlayer(
      locks,
      visibleAudio,
      Date.now,
      new MemoryStorage(),
      visibleDocument as unknown as Document,
    );

    hidden.sync(request);
    visible.sync(request);
    await nextTask();

    assert.equal(hiddenAudio.length, 0);
    assert.equal(visibleAudio.length, 1);
    assert.equal(visibleAudio[0].playCount, 1);
  });

  test('pauses and resumes the same element when visibility changes', async () => {
    const audio: FakeAudio[] = [];
    const player = makePlayer(new FakeLockManager(), audio);
    player.sync(request);
    await nextTask();

    visibility = 'hidden';
    document.dispatchEvent(new window.Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new window.Event('visibilitychange'));
    await nextTask();

    assert.equal(audio.length, 1);
    assert.equal(audio[0].pauseCount, 1);
    assert.equal(audio[0].playCount, 2);
  });

  test('hands music ownership from a hidden tab to a visible tab', async () => {
    const locks = new FakeLockManager();
    const firstDocument = new MusicDocument();
    const secondDocument = new MusicDocument();
    const firstAudio: FakeAudio[] = [];
    const secondAudio: FakeAudio[] = [];
    const first = makePlayer(
      locks,
      firstAudio,
      Date.now,
      new MemoryStorage(),
      firstDocument as unknown as Document,
    );
    const second = makePlayer(
      locks,
      secondAudio,
      Date.now,
      new MemoryStorage(),
      secondDocument as unknown as Document,
    );

    first.sync(request);
    second.sync(request);
    await nextTask();
    firstDocument.visibilityState = 'hidden';
    firstDocument.dispatchEvent(new Event('visibilitychange'));
    await nextTask();
    second.resume();
    await nextTask();

    assert.equal(firstAudio[0].paused, true);
    assert.equal(secondAudio.length, 1);
    assert.equal(secondAudio[0].playCount, 1);
  });

  test('preserves musical phase across a same-tab document navigation', async () => {
    sessionStorage.setItem(
      'sound.background-music.state',
      JSON.stringify({
        name: 'wuxia3',
        position: 12,
        updatedAt: 1_000,
        playing: true,
      }),
    );
    const audio: FakeAudio[] = [];
    const player = makePlayer(new FakeLockManager(), audio, () => 1_750);

    player.sync(request);
    await nextTask();

    assert.equal(audio[0].currentTime, 12.75);
  });

  test('starts a newly selected track independently of the previous track position', async () => {
    const audio: FakeAudio[] = [];
    const player = makePlayer(new FakeLockManager(), audio);
    player.sync(request);
    await nextTask();
    audio[0].currentTime = 42;

    player.sync({
      name: 'gentle-ancient',
      url: '/assets/sound/gentle-ancient/Music.mp3',
      volume: 0.25,
    });
    await nextTask();

    assert.equal(audio.length, 2);
    assert.equal(audio[1].src, '/assets/sound/gentle-ancient/Music.mp3');
    assert.equal(audio[1].currentTime, 0);
    assert.equal(audio[1].playCount, 1);
  });

  test('lets another tab take ownership after the first closes', async () => {
    const locks = new FakeLockManager();
    const firstAudio: FakeAudio[] = [];
    const secondAudio: FakeAudio[] = [];
    const first = makePlayer(locks, firstAudio, Date.now, new MemoryStorage());
    const second = makePlayer(locks, secondAudio, Date.now, new MemoryStorage());

    first.sync(request);
    second.sync(request);
    await nextTask();
    first.dispose();
    await nextTask();
    second.resume();
    await nextTask();

    assert.equal(secondAudio.length, 1);
    assert.equal(secondAudio[0].playCount, 1);
  });

  test('reserves ownership for the same tab across navigation', async () => {
    const locks = new FakeLockManager();
    const firstSession = new MemoryStorage();
    const firstAudio: FakeAudio[] = [];
    const successorAudio: FakeAudio[] = [];
    const secondAudio: FakeAudio[] = [];
    const first = makePlayer(locks, firstAudio, Date.now, firstSession);
    const second = makePlayer(locks, secondAudio, Date.now, new MemoryStorage());

    first.sync(request);
    second.sync(request);
    await nextTask();
    window.dispatchEvent(new window.Event('pagehide'));
    const successor = makePlayer(locks, successorAudio, Date.now, firstSession);
    successor.sync(request);
    first.dispose();
    await nextTask();
    successor.resume();
    await nextTask();

    assert.equal(successorAudio.length, 1);
    assert.equal(successorAudio[0].playCount, 1);
    assert.equal(secondAudio.length, 0);
  });

  test('coordinates tabs when Web Locks are unavailable on local HTTP', async () => {
    const firstAudio: FakeAudio[] = [];
    const secondAudio: FakeAudio[] = [];
    const first = makePlayer(undefined, firstAudio, Date.now, new MemoryStorage());
    const second = makePlayer(undefined, secondAudio, Date.now, new MemoryStorage());

    first.sync(request);
    second.sync(request);
    await new Promise(resolve => setTimeout(resolve, 150));

    assert.equal(firstAudio.length, 1);
    assert.equal(firstAudio[0].playCount, 1);
    assert.equal(secondAudio.length, 0);
  });
});
