import { playable } from 'lib/game';
import { capturedPieces } from 'lib/game/view/captures';
import { type VNode, hl } from 'lib/view';
import { renderBlindfoldToggle } from 'lib/view/blindfold';

import { render as renderGround, boardOrientation } from '../board';
import type RoundController from '../ctrl';
import { next, prev, view } from '../keyboard';
import { replayWheel } from './navigation';
import { roomView } from './room';
import { renderTable } from './table';

export function main(ctrl: RoundController): VNode {
  const d = ctrl.data;
  const jieqi = d.game.variant.key === 'jieqi';
  const hideBoard = ctrl.data.player.blindfold && playable(ctrl.data);
  return ctrl.nvui
    ? ctrl.nvui.render()
    : roomView(d.game.variant.key, [
        renderBlindfoldToggle(ctrl.blindfold),
        hl(
          'div.round__app__board' +
            (jieqi ? '.jieqi-round-board' : '.main-board.xiangqi9x10') +
            (hideBoard ? '.blindfold' : ''),
          {
            hook: replayWheel(
              () => {
                prev(ctrl);
                ctrl.redraw();
              },
              () => {
                next(ctrl);
                ctrl.redraw();
              },
              () => ctrl.isPlaying(),
            ),
          },
          [
            jieqi &&
              hl(
                'div.jieqi-captures-top',
                capturedPieces(
                  d.game.captures ?? d.steps.find(s => s.ply === ctrl.ply)?.captures ?? [],
                  boardOrientation(d, ctrl.flip) === 'white' ? 'red' : 'black',
                  ctrl.ply,
                ),
              ),
            jieqi ? hl('div.main-board.xiangqi9x10', renderGround(ctrl)) : renderGround(ctrl),
            jieqi &&
              hl(
                'div.jieqi-captures-bottom',
                capturedPieces(
                  d.game.captures ?? d.steps.find(s => s.ply === ctrl.ply)?.captures ?? [],
                  boardOrientation(d, ctrl.flip) === 'white' ? 'black' : 'red',
                  ctrl.ply,
                ),
              ),
          ],
        ),
        ctrl.keyboardHelp && view(ctrl),
        renderTable(ctrl),
      ]);
}

export function endGameView(): void {
  const $body = $('body');
  if ($body.hasClass('zen-auto') && $body.hasClass('zen')) {
    $body.toggleClass('zen');
    window.dispatchEvent(new Event('resize'));
  }
}
