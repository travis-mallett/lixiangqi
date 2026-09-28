import { h, type VNode } from 'snabbdom';

import { engineLoadingText, enginePreparing, engineProgress } from 'lib/ceval/engineProgress';
import type { MaybeVNode } from 'lib/view';
import { progressBar } from 'lib/view/progressBar';

import type PuzzleCtrl from '../ctrl';
import afterView from './after';

const initial = (ctrl: PuzzleCtrl): VNode =>
  h('div.puzzle__feedback.play', [
    h('div.player', [
      h('div.no-square', h('piece.king.' + ctrl.pov)),
      h('div.instruction', [
        h('strong', i18n.site.yourTurn),
        h('em', i18n.puzzle[ctrl.pov === 'white' ? 'findTheBestMoveForWhite' : 'findTheBestMoveForBlack']),
      ]),
    ]),
  ]);

const good = (ctrl: PuzzleCtrl): VNode =>
  h('div.puzzle__feedback.good', [
    h('div.player', [
      h('div.icon', '✓'),
      h('div.instruction', [
        h('strong', i18n.puzzle[ctrl.xiangqiBestMove ? 'thisIsTheBestMove' : 'continuationAllowed']),
        ctrl.xiangqiBestMove ? h('em', i18n.puzzle.keepGoing) : undefined,
      ]),
    ]),
  ]);

const fail = (ctrl: PuzzleCtrl): VNode =>
  h('div.puzzle__feedback.fail', [
    h('div.player', [h('div.icon', '✗'), h('div.instruction', [h('strong', ctrl.failureMessage())])]),
  ]);

export default function (ctrl: PuzzleCtrl): MaybeVNode {
  if (enginePreparing(ctrl.engineStatus) || ctrl.engineStatus.state === 'error')
    return h('div.puzzle__feedback.engine-loading', [
      enginePreparing(ctrl.engineStatus) ? progressBar(engineProgress(true, ctrl.engineStatus)) : undefined,
      h('div.instruction', { attrs: { role: 'status', 'aria-live': 'polite' } }, [
        h(
          'strong',
          ctrl.engineStatus.state === 'downloading'
            ? i18n.site.loadingEngine
            : engineLoadingText(ctrl.engineStatus),
        ),
        ctrl.engineStatus.state === 'downloading' ? h('em', engineLoadingText(ctrl.engineStatus)) : undefined,
      ]),
    ]);
  if (ctrl.xiangqiEngineError)
    return h('div.puzzle__feedback', { attrs: { role: 'status', 'aria-live': 'polite' } }, [
      h('div.instruction', i18n.puzzle.alternativeEvaluationUnavailable),
    ]);
  if (ctrl.mode === 'view') return afterView(ctrl);
  if (ctrl.moveEvaluationDepth !== undefined)
    return h('div.puzzle__feedback.engine-loading', [
      progressBar({
        percent: ctrl.moveEvaluationPercent,
        active: true,
        visible: true,
        label: i18n.puzzle.evaluatingMove,
      }),
      h('div.instruction', { attrs: { role: 'status', 'aria-live': 'polite' } }, [
        h('strong', i18n.puzzle.evaluatingMove),
        h('em', i18n.site.depthX(ctrl.moveEvaluationDepth)),
      ]),
    ]);
  switch (ctrl.lastFeedback) {
    case 'init':
      return initial(ctrl);
    case 'good':
      return good(ctrl);
    case 'fail':
      return fail(ctrl);
  }
  return undefined;
}
