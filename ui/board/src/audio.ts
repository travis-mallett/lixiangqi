import { boardAssets } from './catalog';
import type { BoardServices } from './types';

export function boardSoundPath(
  name: string,
  soundSet: string = boardAssets.sounds.defaultSet,
): string | undefined {
  const file = boardAssets.sounds.files[name];
  return file ? `sound/${soundSet}/${file}` : undefined;
}

/** Standalone widgets have local, opt-in audio and never read account/browser preferences. */
export function createBoardAudio(assetUrl: BoardServices['assetUrl']): {
  sound: NonNullable<BoardServices['sound']>;
  destroy: () => void;
} {
  const players = new Map<string, HTMLAudioElement>();
  let disposed = false;
  const play = (path: string, volume = 1) => {
    if (disposed) return;
    let audio = players.get(path);
    if (!audio) {
      audio = new Audio(assetUrl(path));
      players.set(path, audio);
    }
    audio.volume = volume;
    audio.currentTime = 0;
    // Autoplay restrictions and missing audio must never interrupt board navigation.
    void audio.play().catch(() => {});
  };
  return {
    sound: cue => {
      if (cue.move) play(boardSoundPath('move')!);
      const effect = (['checkmate', 'check', 'capture'] as const).find(name => cue.effects.includes(name));
      if (effect) play(boardSoundPath(effect)!);
      if (effect === 'checkmate')
        play(boardAssets.sounds.checkmateEffect.path, boardAssets.sounds.checkmateEffect.volume);
    },
    destroy: () => {
      disposed = true;
      for (const audio of players.values()) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      players.clear();
    },
  };
}
