import { h } from 'snabbdom';

import { isPlayerTurn, playable } from 'lib/game';
import type { MaybeVNode } from 'lib/view';

import type RoundController from '../ctrl';
import { firstMoveMillis } from '../util';

let rang = false;

export default function (ctrl: RoundController): MaybeVNode {
  const d = playable(ctrl.data) && ctrl.data.expiration;
  if (!d) return;
  const timeLeft = firstMoveMillis(d),
    secondsLeft = Math.ceil(timeLeft / 1000),
    myTurn = isPlayerTurn(ctrl.data),
    emerg = myTurn && timeLeft < 8000;
  if (!rang && emerg) {
    site.sound.play('lowTime');
    rang = true;
  }
  const side = myTurn !== ctrl.flip ? 'bottom' : 'top';
  return h(
    'div.expiration.expiration-' + side,
    { class: { emerg, 'bar-glider': myTurn } },
    i18n.site.nbSecondsToPlayTheFirstMove.asArray(secondsLeft, h('strong', secondsLeft)),
  );
}
