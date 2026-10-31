import type { Hooks } from 'snabbdom';

import { displayColumns } from 'lib/device';
import { licon } from 'lib/licon';
import { pubsub } from 'lib/pubsub';
import { storage } from 'lib/storage';
import {
  hl,
  bind,
  replayControlLabel,
  type ReplayAction,
  type LooseVNode,
  type LooseVNodes,
  type VNode,
} from 'lib/view';
import stepwiseScroll from 'lib/view/stepwiseScroll';

export function replayNavigation(
  first: number,
  current: number,
  last: number,
  events: Hooks,
  leading?: LooseVNode,
  trailing?: LooseVNode,
  late = false,
): VNode {
  return hl('bo3', [
    leading || hl('div.noop'),
    [first, current - 1, current + 1, last].map((ply, index) => {
      const enabled = ply !== current && ply >= first && ply <= last;
      const label = replayControlLabel((['first', 'prev', 'next', 'last'] as ReplayAction[])[index]);
      return hl('button.fbt.repeatable', {
        class: { glowing: index === 3 && late },
        attrs: {
          type: 'button',
          disabled: !enabled,
          'data-icon': [licon.JumpFirst, licon.JumpPrev, licon.JumpNext, licon.JumpLast][index],
          'data-ply': enabled ? ply : '-',
          title: label,
          'aria-label': label,
        },
        hook: events,
      });
    }),
    trailing || hl('div.noop'),
  ]);
}

export interface ReplayNavigation {
  first(): void;
  previous(): void;
  next(): void;
  last(): void;
  flip(): void;
}

export function bindReplayKeyboard(replay: ReplayNavigation): () => void {
  const keys: [string[], () => void][] = [
    [['left', 'k'], replay.previous],
    [['right', 'j'], replay.next],
    [['up', '0', 'home'], replay.first],
    [['down', '$', 'end'], replay.last],
    [['f'], replay.flip],
    [['z'], () => pubsub.emit('zen')],
  ];
  keys.forEach(([keys, action]) => site.mousetrap.bind(keys, action));
  return () => keys.flatMap(([keys]) => keys).forEach(key => site.mousetrap.unbind(key));
}

export function replayWheel(
  previous: () => void,
  next: () => void,
  playing: () => boolean,
): Hooks | undefined {
  return 'ontouchstart' in window || !storage.boolean('scrollMoves').getOrDefault(true)
    ? undefined
    : bind(
        'wheel',
        stepwiseScroll(e => {
          if (e.deltaY > 0) next();
          else if (e.deltaY < 0) previous();
        }, playing),
        undefined,
        false,
      );
}

/** Both paired move notation and actor-tagged events use the same mobile replay bar. */
export function replayMoves(
  content: LooseVNodes,
  current: number,
  first: number,
  last: number,
  events: Hooks,
): LooseVNodes {
  if (displayColumns() !== 1) return content;
  const step = (direction: number) =>
    hl('button.fbt', {
      attrs: {
        type: 'button',
        disabled: direction < 0 ? current === first : current === last,
        'data-icon': direction < 0 ? licon.JumpPrev : licon.JumpNext,
        'data-ply': current + direction,
        title: replayControlLabel(direction < 0 ? 'prev' : 'next'),
        'aria-label': replayControlLabel(direction < 0 ? 'prev' : 'next'),
      },
      hook: events,
    });
  return hl('div.col1-moves', [step(-1), content, step(1)]);
}
