import { standardXiangqi } from '@lixiangqi/board';

import { hl, type VNode } from '../../view';
import type { JieqiCapture } from '../jieqi';
import { jieqiRoleName } from './reveal';

/** The caller supplies the visible ledger. Never infer a concealed capture from missing material. */
export function capturedPieces(captures: readonly JieqiCapture[], side: 'red' | 'black', ply: number): VNode {
  const visible = captures.filter(c => c.side === side && c.ply <= ply);
  return hl(
    'div.jieqi-captures',
    {
      attrs: { role: 'list', 'aria-label': i18n.site.capturedPieces },
    },
    visible.map(capture => {
      const role = capture.role && standardXiangqi.roles[capture.role];
      return hl(
        'span.jieqi-captures__piece',
        {
          key: `${capture.ply}:${capture.square}`,
          attrs: { role: 'listitem', title: role ? jieqiRoleName(capture.role!) : i18n.site.concealedPiece },
        },
        [
          hl(`piece.${role || '_'}-piece.${side === 'red' ? 'white' : 'black'}`, {
            attrs: { 'aria-label': role ? jieqiRoleName(capture.role!) : i18n.site.concealedPiece },
          }),
        ],
      );
    }),
  );
}
