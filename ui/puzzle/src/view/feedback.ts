import { h, type VNode } from 'snabbdom';

import { bind, requiresI18n, type MaybeVNode } from 'lib/view';

import type PuzzleCtrl from '../ctrl';
import afterView from './after';

const viewSolution = (ctrl: PuzzleCtrl): VNode =>
  ctrl.streak
    ? h('div.view_solution.skip', { class: { show: ctrl.streak?.data.skip } }, [
        requiresI18n('storm', ctrl.redraw, cat =>
          h(
            'button.button.button-empty',
            { hook: bind('click', ctrl.skip), attrs: { title: i18n.puzzle.streakSkipExplanation } },
            cat.skip,
          ),
        ),
      ])
    : h('div.view_solution', { class: { show: ctrl.canViewSolution() } }, [
        ctrl.moveAllowanceExceeded()
          ? h('button.button', { hook: bind('click', ctrl.retryPuzzle) }, i18n.site.retry)
          : ctrl.mode !== 'view'
            ? h(
                'button.button' + (ctrl.showHint() ? '' : '.button-empty'),
                { hook: bind('click', ctrl.toggleHint) },
                i18n.site.getAHint,
              )
            : undefined,
        h(
          'button.button.button-empty',
          { hook: bind('click', ctrl.viewSolution) },
          i18n.site.viewTheSolution,
        ),
      ]);

const initial = (ctrl: PuzzleCtrl): VNode =>
  h('div.puzzle__feedback.play', [
    h('div.player', [
      h('div.no-square', h('piece.king.' + ctrl.pov)),
      h('div.instruction', [
        h('strong', i18n.site.yourTurn),
        h('em', i18n.puzzle[ctrl.pov === 'white' ? 'findTheBestMoveForWhite' : 'findTheBestMoveForBlack']),
      ]),
    ]),
    viewSolution(ctrl),
  ]);

const good = (ctrl: PuzzleCtrl): VNode =>
  h('div.puzzle__feedback.good', [
    h('div.player', [
      h('div.icon', '✓'),
      h('div.instruction', [
        h(
          'strong',
          ctrl.isXiangqi
            ? i18n.puzzle[ctrl.xiangqiBestMove ? 'thisIsTheBestMove' : 'notMostEfficientMove']
            : i18n.puzzle.bestMove,
        ),
        h(
          'em',
          ctrl.isXiangqi
            ? i18n.puzzle[ctrl.xiangqiBestMove ? 'keepGoing' : 'continuationAllowed']
            : i18n.puzzle.keepGoing,
        ),
      ]),
    ]),
    viewSolution(ctrl),
  ]);

const fail = (ctrl: PuzzleCtrl): VNode =>
  h('div.puzzle__feedback.fail', [
    h('div.player', [
      h('div.icon', '✗'),
      h('div.instruction', [
        h('strong', ctrl.xiangqiFailure ? i18n.puzzle[ctrl.xiangqiFailure] : i18n.puzzle.notTheMove),
        ctrl.moveAllowanceExceeded()
          ? undefined
          : h(
              'em',
              ctrl.xiangqiFailure === 'advantageLost' ? i18n.puzzle.tryAgain : i18n.puzzle.trySomethingElse,
            ),
      ]),
    ]),
    viewSolution(ctrl),
  ]);

export default function (ctrl: PuzzleCtrl): MaybeVNode {
  if (ctrl.xiangqiEngineError)
    return h('div.puzzle__feedback', { attrs: { role: 'status', 'aria-live': 'polite' } }, [
      h('div.instruction', i18n.puzzle.alternativeEvaluationUnavailable),
      ctrl.xiangqiRetry
        ? h('button.button', { hook: bind('click', ctrl.xiangqiRetry) }, i18n.site.retry)
        : undefined,
      viewSolution(ctrl),
    ]);
  if (ctrl.mode === 'view') return afterView(ctrl);
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
