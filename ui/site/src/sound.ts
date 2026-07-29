import { requestIdleCallbackSafe } from 'lib';
import { throttle } from 'lib/async';
import { isIos } from 'lib/device';
import { speakable } from 'lib/game/sanWriter';
import { storage } from 'lib/storage';

import { BackgroundMusic } from './backgroundMusic';

type Name = string;
type Path = string;

class SoundService implements SoundI {
  ctx?: AudioContext;
  ctxPromise: Promise<AudioContext>;
  listeners = new Set<SoundListener>();
  sounds = new Map<Path, Sound>(); // All loaded sounds and their instances
  paths = new Map<Name, Path>(); // sound names to paths
  soundThrottles = new Map<Name, (volume: number) => void>();
  soundSet = document.body.dataset.soundSet!;
  musicSet = document.body.dataset.musicSet!;
  volumeStorage = storage.make('sound-volume');
  soundEnabledStorage = storage.make('sound-enabled');
  musicEnabledStorage = storage.make('music-enabled');
  musicSetStorage = storage.make('music-set');
  backgroundMusic = new BackgroundMusic();
  primerEvents = ['touchend', 'pointerup', 'pointerdown', 'mousedown', 'keydown'];

  constructor() {
    this.primerEvents.forEach(e => window.addEventListener(e, this.primer, { capture: true }));
    window.addEventListener('storage', event => {
      if (event.key === 'sound-volume' || event.key === 'music-enabled') this.syncMusic();
    });
    this.musicSetStorage.listen(event => {
      if (event.value && /^[a-z0-9-]+$/.test(event.value)) {
        this.musicSet = event.value;
        this.syncMusic();
      }
    });
    this.ctxPromise = new Promise((resolve, fail) => {
      requestIdleCallbackSafe(() => {
        this.ctx = makeAudioContext();
        if (this.ctx) resolve(this.ctx);
        else fail(new Error('AudioContext not supported'));
        window.speechSynthesis?.getVoices(); // preload
      });
    });
    queueMicrotask(this.syncMusic);
  }

  primer = async () => {
    this.backgroundMusic.resume();
    try {
      const ctx = await this.ctxPromise;
      await ctx.resume();
    } catch {}
    setTimeout(() => $('#warn-no-autoplay').removeClass('shown'), 500);
    for (const e of this.primerEvents) window.removeEventListener(e, this.primer, { capture: true });
  };

  async load(name: Name, path?: Path): Promise<Sound | undefined> {
    const ctx = await this.ctxPromise;
    if (path) this.paths.set(name, path);
    else path = this.paths.get(name) ?? this.resolvePath(name);
    if (!path) return;
    if (this.sounds.has(path)) return this.sounds.get(path);

    const result = await fetch(path);
    if (!result.ok) throw new Error(`${path} failed ${result.status}`);

    const arrayBuffer = await result.arrayBuffer();
    const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      if (ctx.decodeAudioData.length === 1) ctx.decodeAudioData(arrayBuffer).then(resolve).catch(reject);
      else ctx.decodeAudioData(arrayBuffer, resolve, reject);
    });
    const sound = new Sound(ctx, audioBuffer);
    this.sounds.set(path, sound);
    return sound;
  }

  resolvePath(name: Name): string | undefined {
    if (!this.effectsEnabled()) return;
    return this.url(`${this.soundSet}/${name[0].toUpperCase() + name.slice(1)}.mp3`);
  }

  url(name: Name): string {
    return site.asset.url(`sound/${name}`);
  }

  async play(name: Name, volume = 1): Promise<void> {
    if (!this.effectsEnabled()) return;
    const sound = await this.load(name);
    if (sound && (await this.resumeWithTest())) await sound.play(this.getVolume() * volume);
  }

  throttled = (name: Name, volume: number): void => {
    let play = this.soundThrottles.get(name);
    if (!play) {
      play = throttle(100, (nextVolume: number) => this.play(name, nextVolume));
      this.soundThrottles.set(name, play);
    }
    play(volume);
  };

  async move(o?: SoundMoveOpts) {
    const volume = o?.volume ?? 1;
    if (o?.name) return this.throttled(o.name, volume);

    this.throttled('move', volume);
    if (o?.capture || o?.san?.includes('x')) this.throttled('capture', volume);
    if (o?.mate || o?.san?.includes('#')) this.throttled('checkmate', volume);
    else if (o?.check || o?.san?.includes('+')) this.throttled('check', volume);
  }

  async playAndDelayMateResultIfNecessary(name: Name): Promise<void> {
    if (this.soundSet === 'standard') this.play(name);
    else setTimeout(() => this.play(name), 600);
  }

  async countdown(count: number, interval = 500): Promise<void> {
    if (!this.effectsEnabled()) return;
    try {
      while (count > 0) {
        const promises = [new Promise(r => setTimeout(r, interval)), this.play(`countDown${count}`)];

        if (--count > 0) promises.push(this.load(`countDown${count}`));
        await Promise.all(promises);
      }
      await this.play('genericNotify');
    } catch (e) {
      console.error(e);
    }
  }

  playOnce(name: string): void {
    // increase chances that the first tab can put a local storage lock
    const doIt = () => {
      const store = storage.make('just-played');
      if (Date.now() - parseInt(store.get()!, 10) < 2000) return;
      store.set(String(Date.now()));
      this.play(name);
    };
    if (document.hasFocus()) doIt();
    else setTimeout(doIt, 10 + Math.random() * 500);
  }

  setVolume = (volume: number) => {
    this.volumeStorage.set(volume);
    this.syncMusic();
  };

  getVolume = () => {
    // garbage has been stored here by accident (e972d5612d)
    const v = parseFloat(this.volumeStorage.get() || '');
    return v >= 0 ? v : 0.7;
  };

  isSoundEnabled = () => this.soundEnabledStorage.get() !== '0';

  setSoundEnabled = (enabled: boolean) => {
    this.soundEnabledStorage.set(enabled ? '1' : '0');
  };

  isMusicEnabled = () => this.musicEnabledStorage.get() === '1';

  setMusicEnabled = (enabled: boolean) => {
    this.musicEnabledStorage.set(enabled ? '1' : '0');
    this.syncMusic();
  };

  getVoice = (): SpeechSynthesisVoice | undefined => {
    const voices = speechSynthesis.getVoices();
    const languages = [document.documentElement.lang, document.documentElement.lang.split('-')[0], 'en'];
    return languages.flatMap(language => voices.filter(voice => voice.lang.startsWith(language)))[0];
  };

  effectsEnabled = () => this.isSoundEnabled() && this.soundSet !== 'none' && this.getVolume() !== 0;

  speech = (): boolean => site.blindMode;

  say = (text: string, cut = false, force = false, translated = false) =>
    this.sayLazy(() => text, cut, force, translated);

  sayLazy = (text: () => string, cut = false, force = false, translated = false) => {
    if (typeof window.speechSynthesis === 'undefined') return false;
    try {
      if (cut) speechSynthesis.cancel();
      if (!this.speech() && !force) return false;
      const msg = new SpeechSynthesisUtterance(text());
      const selectedVoice = this.getVoice();
      if (selectedVoice) {
        msg.voice = selectedVoice;
      } else {
        msg.lang = translated ? document.documentElement.lang : 'en-GB';
      }
      msg.volume = this.getVolume();
      if (!isIos()) {
        // speech events are unreliable on iOS, but iphones do their own cancellation
        msg.onstart = () => this.listeners.forEach(l => l('start', text()));
        msg.onend = msg.onerror = () => this.listeners.forEach(l => l('stop'));
      }
      window.speechSynthesis.speak(msg);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  saySan = (san?: San, cut?: boolean, force?: boolean) => this.sayLazy(() => speakable(san), cut, force);

  sayOrPlay = (name: string, text: string) => this.say(text) || this.play(name);

  changeSoundSet = (soundSet: string) => {
    if (isIos()) this.ctx?.resume();
    this.soundSet = soundSet;
  };

  changeMusicSet = (musicSet: string) => {
    this.musicSet = musicSet;
    this.musicSetStorage.fire(musicSet);
    this.syncMusic();
  };

  private readonly musicTrack = (): string | undefined => {
    if (!this.isMusicEnabled() || this.getVolume() === 0) return undefined;
    return this.musicSet !== 'none' ? this.musicSet : undefined;
  };

  private readonly musicVolume = () => this.getVolume() * 0.35;

  private readonly syncMusic = (): void => {
    const track = this.musicTrack();
    this.backgroundMusic.sync(
      track
        ? {
            name: track,
            url: this.url(`${track}/Music.mp3`),
            volume: this.musicVolume(),
          }
        : undefined,
    );
  };

  preloadBoardSounds() {
    for (const name of ['move', 'capture', 'check', 'checkmate', 'genericNotify']) this.load(name);
  }

  async resumeWithTest(): Promise<boolean> {
    if (!this.ctx) return false;
    if (this.ctx.state !== 'running' && this.ctx.state !== 'suspended') {
      // in addition to 'closed', iOS has 'interrupted'. who knows what else is out there
      if (this.ctx.state !== 'closed') this.ctx.close();
      this.ctx = makeAudioContext();
      if (this.ctx) {
        for (const s of this.sounds.values()) s.rewire(this.ctx);
      }
    }
    // if suspended, try audioContext.resume() with a timeout (sometimes it never resolves)
    if (this.ctx?.state === 'suspended') {
      await Promise.race([
        this.ctx.resume(),
        new Promise<void>(resolve => {
          setTimeout(() => {
            $('#warn-no-autoplay').addClass('shown');
            resolve();
          }, 400);
        }),
      ]);
    }

    if (this.ctx?.state !== 'running') return false;
    $('#warn-no-autoplay').removeClass('shown');
    this.syncMusic();
    return true;
  }
}

class Sound {
  node: GainNode;
  ctx: AudioContext;

  constructor(
    ctx: AudioContext,
    readonly buffer: AudioBuffer,
  ) {
    this.rewire(ctx);
  }

  play(volume = 1): Promise<void> {
    this.setVolume(volume);
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.node);
    return new Promise<void>(resolve => {
      source.onended = () => {
        source.disconnect();
        resolve();
      };
      source.start(0);
    });
  }

  setVolume(volume: number): void {
    this.node.gain.setValueAtTime(volume, this.ctx.currentTime);
  }

  rewire(ctx: AudioContext) {
    this.node?.disconnect();
    this.ctx = ctx;
    this.node = this.ctx.createGain();
    this.node.connect(this.ctx.destination);
  }
}

function makeAudioContext(): AudioContext | undefined {
  return window.webkitAudioContext
    ? new window.webkitAudioContext({ latencyHint: 'interactive' })
    : typeof AudioContext !== 'undefined'
      ? new AudioContext({ latencyHint: 'interactive' })
      : undefined;
}

export default new SoundService();
