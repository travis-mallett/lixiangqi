import {
  moveNotation,
  notationElement,
  notationLabel,
  nextTurnSlot,
  turnOrder,
  type Game,
  type Rules,
  type State,
  type TurnSlot,
} from 'threeKingdoms';

import { hl, bind, onInsert, type VNode } from 'lib/view';

export function kingdomMoveRows(
  rules: Rules,
  events: Game['events'],
  states: State[],
  cursor: number,
  select: (index: number) => void,
): VNode[] {
  const labels = { red: i18n.threeKingdoms.shu, green: i18n.threeKingdoms.wu, black: i18n.threeKingdoms.wei };
  const rows = [
    hl('div.kingdom-move-columns', [
      hl('span'),
      ...turnOrder.map(color =>
        hl(`span.kingdom-color--${color}`, { attrs: { title: i18n.threeKingdoms[color] } }, labels[color]),
      ),
    ]),
  ];
  let slot: TurnSlot | undefined;
  let row: VNode[] | undefined;
  const groups: VNode[][] = [];
  events.forEach((event, index) => {
    const notation = moveNotation(rules, states[index], event.action, event.actor);
    const isMove = !!notation.army;
    const next = isMove ? nextTurnSlot(slot, event.actor) : undefined;
    if (!isMove || !row || next?.round !== slot?.round) {
      row = [hl('span.kingdom-move-number', next ? String(next.round) : '·')];
      groups.push(row);
    }
    const title = notationLabel(notation);
    row.push(
      hl(
        'button',
        {
          class: { a1t: index + 1 === cursor },
          attrs: {
            type: 'button',
            title,
            'aria-label': title,
            ...(index + 1 === cursor ? { 'aria-current': 'step' } : {}),
          },
          style: { gridColumn: next ? String(next.column + 2) : '2 / -1' },
          hook: bind('click', () => select(index + 1)),
        },
        [
          hl('span', {
            key: title,
            hook: onInsert(element => element.replaceChildren(notationElement(notation))),
          }),
        ],
      ),
    );
    if (next) slot = next;
    else row = undefined;
  });
  return [...rows, ...groups.map(cells => hl('div.kingdom-move-row', cells))];
}
