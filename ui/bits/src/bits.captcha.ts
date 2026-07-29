import type { Api as XiangqiGroundApi } from 'chessgroundx/api';
import type { Key as XiangqiKey } from 'chessgroundx/types';

import * as domData from 'lib/data';
import { xiangqiCgKeyToUci, xiangqiKeyToCg } from 'lib/game';
import * as xhr from 'lib/xhr';

function init() {
  let failed = false;

  $('div.captcha').each(function (this: HTMLElement) {
    if (this.dataset.initialized) return;

    const $captcha = $(this),
      $board = $captcha.find('.mini-board'),
      $input = $captcha.find('input').val(''),
      cg = domData.get($board[0]!, 'chessground') as XiangqiGroundApi;
    if (!cg) {
      failed = true;
      return;
    }

    $board.on('touchstart', () => {
      const el = document.activeElement as HTMLElement;
      if (el && 'blur' in el) el.blur();
    });

    const fen = cg.getFen(),
      destsObj = $board.data('moves') as Record<string, string[]>,
      dests = new Map<XiangqiKey, XiangqiKey[]>();
    for (const orig in destsObj) dests.set(xiangqiKeyToCg(orig), destsObj[orig].map(xiangqiKeyToCg));
    cg.set({
      turnColor: cg.state.orientation,
      movable: {
        free: false,
        dests,
        color: cg.state.orientation,
        events: {
          after(orig: XiangqiKey, dest: XiangqiKey) {
            $captcha.removeClass('success failure');
            submit(`${xiangqiCgKeyToUci(orig)} ${xiangqiCgKeyToUci(dest)}`);
          },
        },
      },
    });

    const submit = function (solution: string) {
      $input.val(solution);
      xhr.text(xhr.url($captcha.data('check-url'), { solution })).then(data => {
        $captcha.toggleClass('success', data === '1').toggleClass('failure', data !== '1');
        if (data === '1') cg.stop();
        else
          setTimeout(
            () =>
              cg.set({
                fen,
                turnColor: cg.state.orientation,
                movable: { dests },
              }),
            300,
          );
      });
    };

    this.dataset.initialized = '1';
  });

  if (failed) setTimeout(init, 1000);
}

site.load.then(() => setTimeout(init, 1000));
