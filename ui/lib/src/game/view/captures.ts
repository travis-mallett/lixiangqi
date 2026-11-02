import { boardLayout, pieceGeometry, standardXiangqi } from '@lixiangqi/board';

import { hl, type VNode } from '../../view';
import type { JieqiCapture } from '../jieqi';
import { jieqiRoleName } from './reveal';

// Reference image: 48px captured bodies / 76px board bodies. Both use the same artwork.
const capturedPieceRatio = 48 / 76;
const captureWidth =
  (100 * boardLayout(standardXiangqi.geometry).viewport.width * pieceGeometry.scale * capturedPieceRatio) /
  standardXiangqi.geometry.columns;

export interface CaptureLabels {
  capturedPieces: string;
  concealedPiece: string;
  roles: Record<string, string>;
}

export const websiteCaptureLabels = (): CaptureLabels => ({
  capturedPieces: i18n.site.capturedPieces,
  concealedPiece: i18n.site.concealedPiece,
  roles: Object.fromEntries(Object.keys(standardXiangqi.roles).map(role => [role, jieqiRoleName(role)])),
});

/** The caller supplies the visible ledger. Never infer a concealed capture from missing material. */
export function capturedPieces(
  captures: readonly JieqiCapture[],
  side: 'red' | 'black',
  ply: number,
  labels: CaptureLabels = websiteCaptureLabels(),
): VNode {
  const groups = new Map<string, { role?: string | null; concealed: boolean; count: number }>();
  for (const capture of captures) {
    if (capture.side !== side || capture.ply > ply) continue;
    const key = `${capture.role || '_'}:${capture.concealed}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { role: capture.role, concealed: capture.concealed, count: 1 });
  }
  return hl(
    'div.jieqi-captures',
    {
      attrs: {
        role: 'list',
        'aria-label': labels.capturedPieces,
        style: `--jieqi-capture-size: ${captureWidth}cqw`,
      },
    },
    [...groups].map(([key, capture]) => {
      const role = capture.role && standardXiangqi.roles[capture.role];
      const label = role ? labels.roles[capture.role!] : labels.concealedPiece;
      return hl(
        'span.jieqi-captures__piece' + (role && capture.concealed ? '.jieqi-captures__piece--concealed' : ''),
        {
          key,
          attrs: { role: 'listitem', title: label, 'aria-label': `${label} × ${capture.count}` },
        },
        [
          hl(`piece.${role || '_'}-piece.${side === 'red' ? 'white' : 'black'}`, {
            attrs: { 'aria-hidden': 'true' },
          }),
          capture.count > 1 &&
            hl('span.jieqi-captures__count', { attrs: { 'aria-hidden': 'true' } }, String(capture.count)),
        ],
      );
    }),
  );
}
