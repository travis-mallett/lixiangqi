import { throttle } from 'lib/async';

export interface BackgroundMusicRequest {
  name: string;
  url: string;
  volume: number;
}

interface PlaybackState {
  name: string;
  position: number;
  updatedAt: number;
  playing: boolean;
}

type StorageOwnerStatus = 'visible' | 'hidden' | 'navigating';

interface StorageOwner {
  tabId: string;
  instanceId: string;
  status: StorageOwnerStatus;
  updatedAt: number;
}

export interface BackgroundMusicEnvironment {
  window: Window;
  document: Document;
  storage: Storage;
  sharedStorage: Storage;
  locks?: LockManager;
  createAudio(url: string): HTMLAudioElement;
  now(): number;
}

const ownerLock = 'lixiangqi.background-music';
const storageOwnerKey = 'sound.background-music.owner';
const tabIdKey = 'sound.background-music.tab';
const playbackStateKey = 'sound.background-music.state';
const ownerPollMs = 1_000;
const storageSettleMs = 100;
const visibleOwnerTimeoutMs = 10_000;
const navigatingOwnerTimeoutMs = 3_000;

const browserEnvironment = (): BackgroundMusicEnvironment => ({
  window,
  document,
  storage: sessionStorage,
  sharedStorage: localStorage,
  locks: navigator.locks,
  createAudio: url => new Audio(url),
  now: Date.now,
});

export class BackgroundMusic {
  private readonly env: BackgroundMusicEnvironment;
  private readonly ownerPoll: number;
  private readonly tabId: string;
  private readonly instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private request?: BackgroundMusicRequest;
  private audio?: HTMLAudioElement;
  private audioName?: string;
  private audioUrl?: string;
  private audioReady = false;
  private ownsPlayback = false;
  private ownershipPending = false;
  private releaseOwnership?: () => void;
  private playPending?: Promise<void>;
  private storageClaimTimer?: number;
  private ownershipRetryTimer?: number;

  constructor(environment: BackgroundMusicEnvironment = browserEnvironment()) {
    this.env = environment;
    this.tabId = this.readOrCreateTabId();
    this.env.window.addEventListener('pagehide', this.onPageHide);
    this.env.window.addEventListener('pageshow', this.onPageShow);
    this.env.window.addEventListener('storage', this.onStorage);
    this.env.document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.ownerPoll = this.env.window.setInterval(this.maintainOwnership, ownerPollMs);
  }

  sync(request?: BackgroundMusicRequest): void {
    this.request = request;
    if (!request) {
      this.destroyAudio();
      this.relinquishOwnership();
    } else if (this.ownsPlayback) this.syncAudio();
    else this.acquireOwnership();
  }

  resume(): void {
    if (this.ownsPlayback) this.updatePlayback();
    else this.acquireOwnership();
  }

  dispose(): void {
    this.env.window.clearInterval(this.ownerPoll);
    if (this.storageClaimTimer !== undefined) this.env.window.clearTimeout(this.storageClaimTimer);
    if (this.ownershipRetryTimer !== undefined) this.env.window.clearTimeout(this.ownershipRetryTimer);
    this.env.window.removeEventListener('pagehide', this.onPageHide);
    this.env.window.removeEventListener('pageshow', this.onPageShow);
    this.env.window.removeEventListener('storage', this.onStorage);
    this.env.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.destroyAudio();
    this.relinquishOwnership();
  }

  private readonly acquireOwnership = (): void => {
    if (
      !this.request ||
      this.ownsPlayback ||
      this.ownershipPending ||
      this.env.document.visibilityState !== 'visible'
    )
      return;
    if (!this.env.locks) {
      this.acquireStorageOwnership();
      return;
    }

    const owner = this.readStorageOwner();
    if (owner && owner.tabId !== this.tabId && !this.storageOwnerExpired(owner)) return;
    this.setStorageOwner(this.visibilityStatus());
    this.ownershipPending = true;
    void this.env.locks
      .request(ownerLock, { ifAvailable: true, mode: 'exclusive' }, async lock => {
        this.ownershipPending = false;
        if (!lock) {
          this.scheduleOwnershipRetry();
          return;
        }
        if (!this.request || this.readStorageOwner()?.instanceId !== this.instanceId) return;

        this.ownsPlayback = true;
        this.syncAudio();
        await new Promise<void>(resolve => {
          this.releaseOwnership = resolve;
        });
        this.ownsPlayback = false;
        this.releaseOwnership = undefined;
        this.pause(false);
      })
      .catch(() => {
        this.ownershipPending = false;
      });
  };

  private readonly maintainOwnership = (): void => {
    if (this.ownsPlayback) this.writeStorageOwner(this.visibilityStatus());
    else this.acquireOwnership();
  };

  private acquireStorageOwnership(): void {
    const owner = this.readStorageOwner();
    if (owner && owner.tabId !== this.tabId && !this.storageOwnerExpired(owner)) return;

    this.setStorageOwner(this.visibilityStatus());
    if (owner?.tabId === this.tabId) {
      this.finishStorageClaim();
      return;
    }

    this.ownershipPending = true;
    this.storageClaimTimer = this.env.window.setTimeout(() => {
      this.storageClaimTimer = undefined;
      this.ownershipPending = false;
      this.finishStorageClaim();
    }, storageSettleMs);
  }

  private scheduleOwnershipRetry(): void {
    if (!this.request || this.ownershipRetryTimer !== undefined) return;
    this.ownershipRetryTimer = this.env.window.setTimeout(() => {
      this.ownershipRetryTimer = undefined;
      this.acquireOwnership();
    }, 0);
  }

  private finishStorageClaim(): void {
    const owner = this.readStorageOwner();
    if (!this.request || owner?.tabId !== this.tabId || owner.instanceId !== this.instanceId) return;
    this.ownershipPending = false;
    this.ownsPlayback = true;
    this.syncAudio();
  }

  private relinquishOwnership(): void {
    this.ownsPlayback = false;
    if (this.storageClaimTimer !== undefined) {
      this.env.window.clearTimeout(this.storageClaimTimer);
      this.storageClaimTimer = undefined;
    }
    if (this.ownershipRetryTimer !== undefined) {
      this.env.window.clearTimeout(this.ownershipRetryTimer);
      this.ownershipRetryTimer = undefined;
    }
    this.ownershipPending = false;
    this.releaseOwnership?.();
    this.releaseOwnership = undefined;
    const owner = this.readStorageOwner();
    if (owner?.instanceId === this.instanceId) this.env.sharedStorage.removeItem(storageOwnerKey);
  }

  private syncAudio(): void {
    const request = this.request;
    if (!request || !this.ownsPlayback) return;

    if (!this.audio || this.audioName !== request.name || this.audioUrl !== request.url) {
      this.destroyAudio();
      const audio = this.env.createAudio(request.url);
      this.audio = audio;
      this.audioName = request.name;
      this.audioUrl = request.url;
      this.audioReady = audio.readyState >= audio.HAVE_METADATA;
      audio.loop = true;
      audio.preload = 'auto';
      audio.addEventListener('timeupdate', this.savePosition);
      if (this.audioReady) this.restorePosition(audio, request.name);
      else
        audio.addEventListener(
          'loadedmetadata',
          () => {
            if (this.audio !== audio) return;
            this.audioReady = true;
            this.restorePosition(audio, request.name);
            this.updatePlayback();
          },
          { once: true },
        );
    }

    this.audio.volume = request.volume;
    this.updatePlayback();
  }

  private updatePlayback(): void {
    const audio = this.audio;
    if (!audio || !this.audioReady) return;
    if (!this.shouldPlay()) {
      this.pause(false);
      return;
    }
    if (!audio.paused || this.playPending) return;

    const playPending = audio.play();
    this.playPending = playPending;
    void playPending
      .then(() => this.persistPosition(this.shouldPlay()))
      .catch(() => this.persistPosition(false))
      .finally(() => {
        if (this.playPending === playPending) this.playPending = undefined;
        if (!this.shouldPlay()) this.pause(false);
      });
  }

  private shouldPlay(): boolean {
    return this.ownsPlayback && !!this.request && this.env.document.visibilityState === 'visible';
  }

  private readonly onVisibilityChange = (): void => {
    if (this.env.document.visibilityState === 'hidden') {
      this.pause(false);
      this.relinquishOwnership();
    } else {
      this.writeStorageOwner('visible');
      this.resume();
    }
  };

  private readonly onPageHide = (): void => {
    this.writeStorageOwner('navigating');
    this.pause(this.shouldPlay());
  };

  private readonly onPageShow = (): void => {
    this.writeStorageOwner(this.visibilityStatus());
    this.resume();
  };

  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== storageOwnerKey) return;
    const owner = this.readStorageOwner();
    if (owner?.instanceId === this.instanceId) return;
    if (!owner) {
      this.acquireOwnership();
      return;
    }
    this.ownsPlayback = false;
    this.releaseOwnership?.();
    this.pause(false);
  };

  private pause(continueTimeline: boolean): void {
    if (!this.audio) return;
    this.persistPosition(continueTimeline);
    if (!this.audio.paused) this.audio.pause();
  }

  private destroyAudio(): void {
    const audio = this.audio;
    if (!audio) return;
    this.pause(false);
    audio.removeEventListener('timeupdate', this.savePosition);
    audio.removeAttribute('src');
    audio.load();
    this.audio = undefined;
    this.audioName = undefined;
    this.audioUrl = undefined;
    this.audioReady = false;
    this.playPending = undefined;
  }

  private readonly savePosition = throttle(1_000, () => this.persistPosition(true));

  private persistPosition(playing: boolean): void {
    if (!this.audio || !this.audioName || !Number.isFinite(this.audio.currentTime)) return;
    const state: PlaybackState = {
      name: this.audioName,
      position: this.audio.currentTime,
      updatedAt: this.env.now(),
      playing,
    };
    this.env.storage.setItem(playbackStateKey, JSON.stringify(state));
  }

  private restorePosition(audio: HTMLAudioElement, name: string): void {
    const state = this.readPlaybackState(name);
    if (!state) return;
    const elapsed = state.playing ? Math.max(0, this.env.now() - state.updatedAt) / 1_000 : 0;
    const position = state.position + elapsed;
    try {
      audio.currentTime =
        Number.isFinite(audio.duration) && audio.duration > 0 ? position % audio.duration : position;
    } catch {}
  }

  private readPlaybackState(name: string): PlaybackState | undefined {
    try {
      const state = JSON.parse(this.env.storage.getItem(playbackStateKey) ?? 'null');
      if (
        state?.name === name &&
        Number.isFinite(state.position) &&
        state.position >= 0 &&
        Number.isFinite(state.updatedAt) &&
        typeof state.playing === 'boolean'
      )
        return state;
    } catch {}
    return undefined;
  }

  private readOrCreateTabId(): string {
    const existing = this.env.storage.getItem(tabIdKey);
    if (existing) return existing;
    const id = `${this.env.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.env.storage.setItem(tabIdKey, id);
    return id;
  }

  private visibilityStatus(): StorageOwnerStatus {
    return this.env.document.visibilityState === 'hidden' ? 'hidden' : 'visible';
  }

  private writeStorageOwner(status: StorageOwnerStatus): void {
    if (!this.request) return;
    const current = this.readStorageOwner();
    if (this.ownsPlayback || current?.instanceId === this.instanceId || current?.tabId === this.tabId)
      this.setStorageOwner(status);
  }

  private setStorageOwner(status: StorageOwnerStatus): void {
    this.env.sharedStorage.setItem(
      storageOwnerKey,
      JSON.stringify({
        tabId: this.tabId,
        instanceId: this.instanceId,
        status,
        updatedAt: this.env.now(),
      } satisfies StorageOwner),
    );
  }

  private readStorageOwner(): StorageOwner | undefined {
    try {
      const owner = JSON.parse(this.env.sharedStorage.getItem(storageOwnerKey) ?? 'null');
      if (
        typeof owner?.tabId === 'string' &&
        typeof owner.instanceId === 'string' &&
        ['visible', 'hidden', 'navigating'].includes(owner.status) &&
        Number.isFinite(owner.updatedAt)
      )
        return owner;
    } catch {}
    return undefined;
  }

  private storageOwnerExpired(owner: StorageOwner): boolean {
    const age = Math.max(0, this.env.now() - owner.updatedAt);
    if (owner.status === 'navigating') return age > navigatingOwnerTimeoutMs;
    // Compatibility with ownership records written by older clients. Hidden
    // tabs are silent and must not prevent a visible tab from taking over.
    if (owner.status === 'hidden') return true;
    return age > visibleOwnerTimeoutMs;
  }
}
