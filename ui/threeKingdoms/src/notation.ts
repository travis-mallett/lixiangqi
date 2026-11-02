import { el } from './dom';
import type { Color, Rules, State } from './types';

/** Display order follows play order. Score vectors use the separate `colors` order. */
export const turnOrder: readonly Color[] = ['red', 'green', 'black'];

export interface MoveNotation {
  text: string;
  actor: Color;
  army?: Color;
  symbol?: string;
}

const symbols: Record<Color, Record<string, string>> = {
  red: {
    general: '蜀',
    advisor: '仕',
    elephant: '相',
    horse: '傌',
    chariot: '俥',
    cannon: '炮',
    soldier: '兵',
  },
  green: {
    general: '吳',
    advisor: '士',
    elephant: '向',
    horse: '馬',
    chariot: '車',
    cannon: '礮',
    soldier: '勇',
  },
  black: {
    general: '魏',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '砲',
    soldier: '卒',
  },
};

export function moveNotation(
  rules: Rules,
  before: State,
  action: string,
  actor: Color = before.turn,
): MoveNotation {
  if (!action.includes('>'))
    return { actor, text: (i18n.threeKingdoms as unknown as Record<string, string>)[action] ?? action };
  const piece = before.pieces.find(piece => piece.location === action.split('>')[0]);
  if (!piece) throw new Error('Missing notation piece');
  return {
    text: rules.notation(before.position, action),
    actor,
    army: piece.army,
    symbol: symbols[piece.army][piece.role],
  };
}

export function notationLabel(move: MoveNotation): string {
  const owner = i18n.threeKingdoms[move.actor];
  const army = move.army && move.army !== move.actor ? ` (${i18n.threeKingdoms[move.army]})` : '';
  return `${owner}${army}: ${move.text}`;
}

/** Shared by live games, analysis and engine lines. Army color never changes on takeover. */
export function notationElement(move: MoveNotation): HTMLElement {
  const token = el('span', 'kingdom-notation');
  token.title = notationLabel(move);
  token.setAttribute('aria-label', token.title);
  if (move.symbol) {
    const piece = el('span', `kingdom-piece kingdom-color--${move.army}`, move.symbol);
    piece.setAttribute('aria-hidden', 'true');
    if (move.army !== move.actor)
      piece.append(el('span', `kingdom-notation__controller kingdom-color--${move.actor}`));
    const body = el('span', 'kingdom-notation__body', move.text.slice(1));
    body.setAttribute('aria-hidden', 'true');
    token.append(piece, body);
  } else token.textContent = `${i18n.threeKingdoms[move.actor]}: ${move.text}`;
  return token;
}

export interface TurnSlot {
  round: number;
  column: number;
}

/** Events (including off-turn resignations) do not consume a move or a player column. */
export function nextTurnSlot(previous: TurnSlot | undefined, actor: Color): TurnSlot {
  const column = turnOrder.indexOf(actor);
  return { column, round: previous ? previous.round + Number(column <= previous.column) : 1 };
}
