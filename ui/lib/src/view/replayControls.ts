import type { Hooks, VNode } from 'snabbdom';

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
  labels?: Partial<Record<ReplayAction, string>>;
  onClick: (action: string, event: MouseEvent) => void;
  onHold?: (action: string, event: PointerEvent) => void;
  previousIcon?: LiconValue;
  nextIcon?: LiconValue;
  glowingLast?: boolean;
  extraJumps?: LooseVNodes;
  controls?: LooseVNodes;
}

function actionFromEvent(event: MouseEvent): string | undefined {
  const button =
    event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>('button[data-act]')
      : undefined;
  return button && !button.disabled ? button.dataset.act : undefined;
}

export type ReplayAction = keyof ReplayControlAvailability;

export const replayControlLabel = (action: ReplayAction): string =>
  ({
    first: i18n.site.firstPosition,
    prev: i18n.site.previousMove,
    next: i18n.site.nextMove,
    last: i18n.site.lastPosition,
  })[action];

/** Preserve touch scrolling and pointer holds, with native button activation for keyboards and AT. */
export function bindReplayEvents(
  click: (event: MouseEvent) => void,
  hold?: (event: PointerEvent) => void,
): Hooks {
  return onInsert(el => {
    addPointerListeners(el, { click, hold });
    el.addEventListener('click', event => {
      // Pointer activation was handled on pointerup. Native keyboard/AT clicks have no click count.
      if (event.detail === 0) click(event);
    });
  });
}

function jumpButton(
  icon: LiconValue,
  action: ReplayAction,
  enabled: boolean,
  label: string,
  glowing = false,
): VNode {
  return hl('button.fbt.move', {
    class: { glowing },
    attrs: {
      type: 'button',
      disabled: !enabled,
      'data-act': action,
      'data-icon': icon,
      title: label,
      'aria-label': label,
    },
  });
}

export function renderReplayControls(opts: ReplayControlsOptions): VNode {
  const labelFor = (action: ReplayAction) => opts.labels?.[action] ?? replayControlLabel(action);
  return hl(
    `${opts.selector}.analyse-controls.replay-controls`,
    {
      hook: bindReplayEvents(
        event => {
          const action = actionFromEvent(event);
          if (action) opts.onClick(action, event);
        },
        opts.onHold
          ? event => {
              const action = actionFromEvent(event);
              if (action) opts.onHold!(action, event);
            }
          : undefined,
      ),
    },
    [
      hl('div.jumps', [
        jumpButton(licon.JumpFirst, 'first', opts.enabled.first, labelFor('first')),
        jumpButton(opts.previousIcon ?? licon.LessThan, 'prev', opts.enabled.prev, labelFor('prev')),
        jumpButton(opts.nextIcon ?? licon.GreaterThan, 'next', opts.enabled.next, labelFor('next')),
        jumpButton(licon.JumpLast, 'last', opts.enabled.last, labelFor('last'), opts.glowingLast),
        opts.extraJumps,
      ]),
      opts.controls,
    ],
  );
}
