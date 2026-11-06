import { JIEQI_START_FEN } from 'lib/game/jieqi';
import { MANCHU_START_FEN } from 'lib/game/manchu';
import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';
import { XIANGQI_START_FEN } from 'lib/game/xiangqi';

export type AnalysisVariant = 'xiangqi' | 'jieqi' | 'minixiangqi' | 'manchu' | 'threeKingdoms';

export function analysisStartFen(variant?: string): string {
  if (variant === 'jieqi') return JIEQI_START_FEN;
  if (variant === 'minixiangqi') return MINI_XIANGQI_START_FEN;
  if (variant === 'manchu') return MANCHU_START_FEN;
  return XIANGQI_START_FEN;
}

export function useNativeReplay(
  states: readonly unknown[] | undefined,
  moves: readonly unknown[] | undefined,
  hasHandoff: boolean,
  hasFenQuery: boolean,
  hasGameId: boolean,
): boolean {
  return !hasHandoff && (!hasFenQuery || hasGameId) && states?.length === (moves?.length ?? 0) + 1;
}

export function bindAnalysisStartReset(
  button: HTMLElement,
  currentVariant: () => string | undefined,
  loadFen: (fen: string) => void | Promise<void>,
): void {
  button.addEventListener('click', () => {
    void loadFen(analysisStartFen(currentVariant()));
  });
}

/** Shared by every analysis rules adapter. */
export function analysisVariantPicker(
  variant: AnalysisVariant,
  change: (variant: AnalysisVariant) => void,
): HTMLSelectElement {
  const label = document.createElement('label');
  label.className = 'xiangqi-analysis-variant';
  label.append(i18n.site.variant + ' ');
  const select = document.createElement('select');
  for (const [key, text] of [
    ['xiangqi', i18n.site.xiangqi],
    ['jieqi', i18n.site.jieqi],
    ['minixiangqi', i18n.site.miniXiangqi],
    ['manchu', i18n.site.manchu],
    ['threeKingdoms', i18n.site.threeKingdoms],
  ])
    select.append(new Option(text, key, false, key === variant));
  select.addEventListener('change', () => change(select.value as AnalysisVariant));
  label.append(select);
  document.querySelector('.xiangqi-analysis-panel')!.prepend(label);
  return select;
}
