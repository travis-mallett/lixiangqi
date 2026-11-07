import { boardDefinition, positionFromFen, positionToFen } from '@lixiangqi/board';

import type { EditorVariant } from './interfaces';

export const emptyFen = '9/9/9/9/9/9/9/9/9/9 w - - 0 1';

/** Parse a rectangular editable diagram; placement legality remains owned by the rules API. */
export function editorFen(raw: string, selected: EditorVariant = 'xiangqi'): string | undefined {
  if (selected === 'threeKingdoms') return;
  const definition = boardDefinition(selected === 'jieqi' ? 'xiangqi' : selected);
  const marker = selected === 'jieqi' ? 'j' : selected === 'manchu' ? 'm' : '-';
  const fields = raw.replace(/_/g, ' ').trim().split(/\s+/);
  if (![1, 2, 6].includes(fields.length)) return;
  const [placement, turn = 'w', variant = '-', ep = '-', half = '0', full = '1'] = fields;
  if (
    !/^[rnbakcp1-9/xm]+$/i.test(placement) ||
    (selected !== 'jieqi' && /x/i.test(placement)) ||
    (variant !== '-' && variant !== marker) ||
    ep !== '-' ||
    !/^\d+$/.test(half) ||
    !/^\d+$/.test(full) ||
    Number(half) > 2147483647 ||
    Number(full) > 1073741823 ||
    Number(full) < 1
  )
    return;
  try {
    const position = positionFromFen(`${placement} ${turn}`, definition);
    return `${positionToFen(position, definition)} ${marker} - ${Number(half)} ${Number(full)}`;
  } catch {
    // Invalid board geometry or side to move.
    return undefined;
  }
}
