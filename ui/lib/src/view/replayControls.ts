import type { VNode } from 'snabbdom';

import { licon, type LiconValue } from '@/licon';
import { addPointerListeners } from '@/pointer';
import { hl, type LooseVNodes, onInsert } from '@/view/snabbdom';

export interface ReplayControlAvailability {
  first: boolean;
  prev: boolean;
  next: boolean;
  last: boolean;
}

export interface ReplayControlsOptions {
  selector: string;
  enabled: ReplayControlAvailability;
  onClick: (action: string, event: PointerEvent) => void;
  onHold?: (action: string, event: PointerEvent) => void;
  previousIcon?: LiconValue;
  nextIcon?: LiconValue;
  glowingLast?: boolean;
  extraJumps?: LooseVNodes;
  controls?: LooseVNodes;
}

function actionFromEvent(event: PointerEvent): string | undefined {
  return event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>('[data-act]')?.dataset.act
    : undefined;
}

function jumpButton(icon: LiconValue, action: string, enabled: boolean, glowing = false): VNode {
  return hl('button.fbt.move', {
    class: { glowing },
    attrs: { disabled: !enabled, 'data-act': action, 'data-icon': icon },
  });
}

export function renderReplayControls(opts: ReplayControlsOptions): VNode {
  const act = (event: PointerEvent, handler: ReplayControlsOptions['onClick']): void => {
    const action = actionFromEvent(event);
    if (action) handler(action, event);
  };
  return hl(
    `${opts.selector}.analyse-controls.replay-controls`,
    {
      hook: onInsert(el =>
        addPointerListeners(el, {
          click: event => act(event, opts.onClick),
          hold: opts.onHold ? event => act(event, opts.onHold!) : undefined,
        }),
      ),
    },
    [
      hl('div.jumps', [
        jumpButton(licon.JumpFirst, 'first', opts.enabled.first),
        jumpButton(opts.previousIcon ?? licon.LessThan, 'prev', opts.enabled.prev),
        jumpButton(opts.nextIcon ?? licon.GreaterThan, 'next', opts.enabled.next),
        jumpButton(licon.JumpLast, 'last', opts.enabled.last, opts.glowingLast),
        opts.extraJumps,
      ]),
      opts.controls,
    ],
  );
}
