import { createAnalysisUrl } from 'xiangqi';

import { licon, type LiconValue } from 'lib/licon';
import { bind, hl, icon, type VNode } from 'lib/view';

import type PuzzleCtrl from '../ctrl';

export default function actions(ctrl: PuzzleCtrl): VNode {
  const enabled = ctrl.canUseActions();

  const action = (name: string, label: string, glyph: LiconValue, click: () => void, disabled = false) =>
    hl(
      `button.fbt.${name}`,
      {
        attrs: { type: 'button', title: label, disabled },
        class: { disabled },
        hook: bind('click', click),
      },
      [icon(glyph)(), hl('span', label)],
    );
  return hl(
    'div.puzzle__actions',
    { class: { failed: !!ctrl.xiangqiFailure, solved: ctrl.lastFeedback === 'win' } },
    [
      action('retry', i18n.site.retry, licon.Back, ctrl.retryFailedMove, !ctrl.canRetry()),
      action('restart', i18n.puzzle.restart, licon.Reload, ctrl.retryPuzzle, !enabled),
      ctrl.completed
        ? hl(
            'a.fbt.analyze',
            {
              attrs: {
                title: i18n.puzzle.analyze,
                ...(enabled
                  ? { href: createAnalysisUrl(ctrl.tree, ctrl.pov === 'white' ? 'red' : 'black', ctrl.path) }
                  : {}),
                'aria-disabled': String(!enabled),
                tabindex: enabled ? 0 : -1,
                target: '_blank',
                rel: 'noopener',
              },
              class: { disabled: !enabled },
            },
            [icon(licon.Search)(), hl('span', i18n.puzzle.analyze)],
          )
        : action('hint', i18n.puzzle.hint, licon.InfoCircle, ctrl.toggleHint, !ctrl.canHint()),
      action('solution', i18n.site.solution, licon.Book, ctrl.viewSolution, !enabled),
      action('next', i18n.site.next, licon.PlayTriangle, ctrl.nextPuzzle, !enabled),
    ],
  );
}
