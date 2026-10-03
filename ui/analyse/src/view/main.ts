import { render as renderKeyboardMove } from 'keyboard-move';

import { renderChat } from 'lib/chat/renderChat';
import { displayColumns } from 'lib/device';
import { playable } from 'lib/game';
import * as router from 'lib/game/router';
import { licon } from 'lib/licon';
import { type VNode, onInsert, hl } from 'lib/view';
import { watchers } from 'lib/view/watchers';

import type AnalyseCtrl from '@/ctrl';
import forecastView from '@/forecast/forecastView';
import { view as keyboardView } from '@/keyboard';
import { relayView } from '@/study/relay/relayView';
import type * as studyDeps from '@/study/studyDeps';
import { studyView } from '@/study/studyView';
import { renderXiangqiGauge } from '@/view/xiangqiEngine';
import { wikiToggleBox } from '@/wiki';

import { viewContext, renderBoard, renderMain, renderUnderboard } from './components';
import { renderControls } from './controls';
import { render as trainingView } from './roundTraining';
import { renderTools } from './tools';

let resizeCache: {
  columns: number;
  chat: HTMLElement | null;
  board: HTMLElement | null;
  meta: HTMLElement | null;
};

export default function (deps?: typeof studyDeps) {
  return function (ctrl: AnalyseCtrl): VNode {
    resizeCache ??= resizeHandler(ctrl);
    if (ctrl.nvui) return ctrl.nvui.render(deps);
    else if (deps && ctrl.study?.relay) return relayView(ctrl, ctrl.study, ctrl.study.relay, deps);
    else if (deps && ctrl.study) return studyView(ctrl, ctrl.study, deps);
    else return analyseView(ctrl, deps);
  };
}

function analyseView(ctrl: AnalyseCtrl, deps?: typeof studyDeps): VNode {
  const ctx = viewContext(ctrl, deps);
  return renderMain(
    ctx,
    ctrl.keyboardHelp && keyboardView(ctrl),
    renderBoard(ctx),
    ctx.gaugeOn && renderXiangqiGauge(ctrl),
    renderTools(ctx),
    renderControls(ctrl),
    renderUnderboard(ctx),
    ctrl.keyboardMove && renderKeyboardMove(ctrl.keyboardMove),
    trainingView(ctrl),
    hl(
      'aside.analyse__side',
      {
        hook: onInsert(elm => {
          if (ctrl.opts.$side?.length) {
            $(elm).replaceWith(ctrl.opts.$side);
            wikiToggleBox();
          }
        }),
      },
      [
        ctrl.forecast && forecastView(ctrl, ctrl.forecast),
        !ctrl.synthetic &&
          playable(ctrl.data) &&
          hl(
            'div.back-to-game',
            hl(
              'a.button.button-empty.text',
              {
                attrs: {
                  href: router.game(ctrl.data.game.id, ctrl.data.player.color === 'red' ? 'white' : 'black'),
                  'data-icon': licon.Back,
                },
              },
              i18n.site.backToGame,
            ),
          ),
      ],
    ),
    ctrl.chatCtrl && renderChat(ctrl.chatCtrl, { insert: v => fixChatHeight(v.elm) }),
    hl('div.chat__members.none', { hook: onInsert(watchers) }),
  );
}

function resizeHandler(ctrl: AnalyseCtrl) {
  window.addEventListener('resize', () => {
    if (resizeCache.columns !== displayColumns()) ctrl.redraw();
    resizeCache.columns = displayColumns();

    if (ctrl.study || resizeCache.columns < 3) return;

    resizeCache.chat ??= document.querySelector<HTMLElement>('.mchat');
    fixChatHeight(resizeCache.chat);
  });
  return { columns: displayColumns(), chat: null, board: null, meta: null };
}

function fixChatHeight(el: Node | null | undefined) {
  if (!(el instanceof HTMLElement)) return;
  resizeCache.board ??= document.querySelector<HTMLElement>('.analyse__board .cg-wrap');
  resizeCache.meta ??= document.querySelector<HTMLElement>('.game__meta');
  if (!resizeCache.board || !resizeCache.meta) return;
  el.style.height = `${resizeCache.board.offsetHeight - resizeCache.meta.offsetHeight - 16}px`;
}
