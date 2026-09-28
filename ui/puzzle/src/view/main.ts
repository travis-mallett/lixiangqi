import { type VNode, h } from 'snabbdom';

import { licon } from 'lib/licon';
import { storage } from 'lib/storage';
import {
  toggleButton as boardMenuToggleButton,
  bindNonPassive,
  hl,
  type MaybeVNode,
  renderReplayControls,
} from 'lib/view';
import { renderBlindfoldToggle } from 'lib/view/blindfold';
import stepwiseScroll from 'lib/view/stepwiseScroll';

import * as control from '@/control';
import type PuzzleCtrl from '@/ctrl';
import { view as keyboardView } from '@/keyboard';

import actions from './actions';
import boardMenu from './boardMenu';
import chessground from './chessground';
import feedbackView from './feedback';
import { replay, puzzleBox, userBox, streakBox, config } from './side';
import theme from './theme';
import { render as treeView } from './tree';

function controls(ctrl: PuzzleCtrl): VNode {
  const node = ctrl.node;
  const nextNode = node.children[0];
  const notOnLastMove = ctrl.mode === 'play' && nextNode && nextNode.puzzle !== 'fail';
  return renderReplayControls({
    selector: 'div.puzzle__controls',
    enabled: { first: !!node.ply, prev: !!node.ply, next: !!nextNode, last: !!nextNode },
    previousIcon: licon.JumpPrev,
    nextIcon: licon.JumpNext,
    glowingLast: !!notOnLastMove,
    extraJumps: boardMenuToggleButton(ctrl.menu, i18n.site.menu),
    controls: boardMenu(ctrl),
    onClick: action => {
      if (action === 'prev') control.prev(ctrl);
      else if (action === 'next') control.next(ctrl);
      else if (action === 'first') control.first(ctrl);
      else if (action === 'last') control.last(ctrl);
      ctrl.redraw();
    },
  });
}

export default function (ctrl: PuzzleCtrl): VNode {
  return hl(
    `main.puzzle.puzzle-${ctrl.data.replay ? 'replay' : 'play'}${ctrl.streak ? '.puzzle--streak' : ''}.puzzle-xiangqi`,
    [
      renderBlindfoldToggle(ctrl.blindfold),
      hl('aside.puzzle__side', [
        replay(ctrl),
        puzzleBox(ctrl),
        ctrl.streak ? streakBox(ctrl) : userBox(ctrl),
        theme(ctrl),
        config(ctrl),
      ]),
      hl(
        `div.puzzle__board.main-board.xiangqi9x10${ctrl.blindfold() ? '.blindfold' : ''}`,
        {
          hook:
            'ontouchstart' in window || !storage.boolean('scrollMoves').getOrDefault(true)
              ? undefined
              : bindNonPassive(
                  'wheel',
                  stepwiseScroll(
                    e => {
                      if (e.deltaY > 0) control.next(ctrl);
                      else if (e.deltaY < 0) control.prev(ctrl);
                      ctrl.redraw();
                    },
                    e => !['PIECE', 'SQUARE', 'CG-BOARD'].includes((e.target as HTMLElement).tagName),
                  ),
                ),
        },
        [chessground(ctrl)],
      ),
      hl('div.puzzle__tools', [treeView(ctrl), feedbackView(ctrl), actions(ctrl)]),
      controls(ctrl),
      session(ctrl),
      ctrl.keyboardHelp() && keyboardView(ctrl),
    ],
  );
}

function session(ctrl: PuzzleCtrl): MaybeVNode {
  const rounds = ctrl.session.get().rounds;

  if (!rounds.length) return undefined;

  const { id: currentId } = ctrl.data.puzzle;
  const { theme } = ctrl.session;

  return hl('div.puzzle__session', [
    rounds.map(({ id, result, ratingDiff }) => {
      const rd =
        ratingDiff && ctrl.opts.showRatings ? (ratingDiff > 0 ? '+' + ratingDiff : ratingDiff) : null;

      return h(
        `a.result-${result}`,
        {
          key: id,
          class: { current: currentId === id, 'result-empty': !rd },
          attrs: {
            href: `/training/${theme}/${id}`,
            ...(ctrl.streak ? { target: '_blank' } : {}),
          },
        },
        rd,
      );
    }),
    rounds.some(r => r.id === currentId)
      ? !ctrl.streak && hl('a.session-new', { key: 'new', attrs: { href: `/training/${theme}` } })
      : hl(
          'a.result-cursor.current',
          {
            key: currentId,
            attrs: ctrl.streak ? {} : { href: `/training/${theme}/${currentId}` },
          },
          ctrl.streak && (ctrl.streak.data.index + 1).toString(),
        ),
  ]);
}
