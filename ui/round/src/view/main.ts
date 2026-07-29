import { displayColumns, isTouchDevice } from 'lib/device';
import { playable } from 'lib/game';
import { storage } from 'lib/storage';
import { type VNode, hl, bind } from 'lib/view';
import { renderBlindfoldToggle } from 'lib/view/blindfold';
import stepwiseScroll from 'lib/view/stepwiseScroll';

import type RoundController from '../ctrl';
import { render as renderGround } from '../ground';
import { next, prev, view } from '../keyboard';
import { renderTable } from './table';

export function main(ctrl: RoundController): VNode {
  const d = ctrl.data;
  const hideBoard = ctrl.data.player.blindfold && playable(ctrl.data);
  return ctrl.nvui
    ? ctrl.nvui.render()
    : hl(
        'div.round__app.variant-' + d.game.variant.key,
        {
          class: {
            'swap-clock': isTouchDevice() && displayColumns() === 1 && storage.boolean('swapClock').get(),
          },
        },
        [
          renderBlindfoldToggle(ctrl.blindfold),
          hl(
            'div.round__app__board.main-board.xiangqi9x10' + (hideBoard ? '.blindfold' : ''),
            {
              hook:
                'ontouchstart' in window || !storage.boolean('scrollMoves').getOrDefault(true)
                  ? undefined
                  : bind(
                      'wheel',
                      stepwiseScroll(
                        e => {
                          if (e.deltaY > 0) next(ctrl);
                          else if (e.deltaY < 0) prev(ctrl);
                          ctrl.redraw();
                        },
                        () => ctrl.isPlaying(),
                      ),
                      undefined,
                      false,
                    ),
            },
            [renderGround(ctrl)],
          ),
          ctrl.keyboardHelp && view(ctrl),
          renderTable(ctrl),
        ],
      );
}

export function endGameView(): void {
  const $body = $('body');
  if ($body.hasClass('zen-auto') && $body.hasClass('zen')) {
    $body.toggleClass('zen');
    window.dispatchEvent(new Event('resize'));
  }
}
