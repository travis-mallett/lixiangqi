import { coordinateMove, type BoardMark } from '@lixiangqi/board';

import { requestXiangqi } from 'lib/game/xiangqiApi';
import { rulesPositionKey, type RulesPosition } from 'lib/game/xiangqiNotation';

import type { Settings } from '@/settingsCtrl';

interface Motifs {
  pins: { pinned: string; pinner: string; target: string }[];
  undefended: { square: string; materialLoss: number; principalAttacker: string }[];
  checkable: { general: string; move: string }[];
}

/** Optional tactical overlays use the same native rules boundary and history as analysis. */
export default class MotifCtrl {
  error?: string;
  private readonly cache = new Map<string, Motifs>();
  private pending?: AbortController;
  private current?: string;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly settings: Settings,
    private readonly redraw: () => void,
  ) {}

  any = (): boolean =>
    this.settings.showPinnedPieces ||
    this.settings.showCheckableGeneral ||
    this.settings.showUndefendedPieces;

  shapes(position: RulesPosition): BoardMark[] {
    const key = rulesPositionKey(position);
    if (key !== this.current) {
      this.pending?.abort();
      clearTimeout(this.timer);
      this.current = key;
      this.error = undefined;
      if (!this.cache.has(key)) {
        const abort = (this.pending = new AbortController());
        this.timer = setTimeout(() => {
          void requestXiangqi<Motifs>('/api/analysis/motifs', position, abort.signal)
            .then(motifs => {
              this.cache.set(key, motifs);
              while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
              if (this.current === key) this.redraw();
            })
            .catch(error => {
              if (error.name !== 'AbortError' && this.current === key) {
                this.error = error.message;
                this.redraw();
              }
            });
        }, 180);
      }
    }
    const motifs = this.cache.get(key);
    if (!motifs) return [];
    return [
      ...(this.settings.showPinnedPieces
        ? motifs.pins.flatMap(pin => [
            { from: pin.pinned, brush: 'paleRed' },
            { from: pin.pinner, to: pin.target, brush: 'paleRed' },
          ])
        : []),
      ...(this.settings.showUndefendedPieces
        ? motifs.undefended.map(piece => ({ from: piece.square, brush: 'yellow' }))
        : []),
      ...(this.settings.showCheckableGeneral
        ? motifs.checkable.flatMap(check => {
            const [from, to] = coordinateMove(check.move);
            return [
              { from: check.general, brush: 'red' },
              { from, to, brush: 'paleRed' },
            ];
          })
        : []),
    ];
  }

  destroy(): void {
    this.pending?.abort();
    clearTimeout(this.timer);
  }
}
