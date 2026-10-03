import { coordinateMove } from '@lixiangqi/board';
import { h, type VNodeChildren } from 'snabbdom';

import { storage } from '../storage';
import * as path from '../tree/path';
import type { TreeNode } from '../tree/types';
import { Notify } from './notify';
import { makeSetting, type Setting, type Choices } from './settings';

export type MoveStyle = 'coordinate' | 'notation' | 'spoken' | 'nato' | 'anna';
export type PieceStyle = 'letter' | 'red uppercase letter' | 'name' | 'red uppercase name';
export type PrefixStyle = 'letter' | 'name' | 'none';
export type PositionStyle = 'before' | 'after' | 'none';
export type BoardStyle = 'plain' | 'table';
export type PageStyle = 'board-actions' | 'actions-board';

export interface NvuiContext {
  notify: Notify;
  moveStyle: Setting<MoveStyle>;
  pieceStyle: Setting<PieceStyle>;
  prefixStyle: Setting<PrefixStyle>;
  positionStyle: Setting<PositionStyle>;
  boardStyle: Setting<BoardStyle>;
  pageStyle: Setting<PageStyle>;
}

export function makeContext<T extends NvuiContext>(ctx: Omit<T, keyof NvuiContext>, redraw?: Redraw): T {
  const setting = <A>(key: string, value: A, choices: Choices<A>) =>
    makeSetting({ default: value, choices, storage: storage.make(`nvui.xiangqi.${key}`) });
  return {
    ...ctx,
    notify: new Notify(redraw),
    moveStyle: setting<MoveStyle>(
      'move',
      'spoken',
      ['coordinate', 'notation', 'spoken', 'nato', 'anna'].map(style => [
        style as MoveStyle,
        `${style}: ${renderMove('H2+3', 'h1g3', style as MoveStyle)}`,
      ]),
    ),
    pieceStyle: setting<PieceStyle>('piece', 'name', [
      ['letter', i18n.nvui.pieceLetter],
      ['red uppercase letter', i18n.nvui.redUppercaseLetter],
      ['name', i18n.nvui.pieceName],
      ['red uppercase name', i18n.nvui.redUppercaseName],
    ]),
    prefixStyle: setting<PrefixStyle>('prefix', 'name', [
      ['letter', i18n.nvui.sideLetter],
      ['name', i18n.nvui.sideName],
      ['none', i18n.site.none],
    ]),
    positionStyle: setting<PositionStyle>('position', 'before', [
      ['before', i18n.nvui.positionBefore],
      ['after', i18n.nvui.positionAfter],
      ['none', i18n.site.none],
    ]),
    boardStyle: setting<BoardStyle>('board', 'table', [
      ['plain', i18n.nvui.plainBoard],
      ['table', i18n.nvui.tableBoard],
    ]),
    pageStyle: setting<PageStyle>('page', 'actions-board', [
      ['board-actions', `${i18n.site.board} ${i18n.nvui.actions}`],
      ['actions-board', `${i18n.nvui.actions} ${i18n.site.board}`],
    ]),
  } as T;
}

export function renderMove(notation: string | undefined, uci: string | undefined, style: MoveStyle): string {
  if (!uci) return notation ?? i18n.nvui.gameStart;
  if (style === 'coordinate') return uci;
  if (style === 'notation') return notation ?? uci;
  const alphabets = {
    nato: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'],
    anna: ['Anna', 'Bella', 'Cesar', 'David', 'Eva', 'Felix', 'Gustav', 'Hector', 'Ida'],
  };
  const location = (square: string) =>
    `${style === 'nato' || style === 'anna' ? alphabets[style][square.charCodeAt(0) - 97] : square[0]} ${square.slice(1)}`;
  const [from, to] = coordinateMove(uci);
  return `${notation ?? ''}: ${i18n.nvui.moveFromTo(location(from), location(to))}`;
}

export const renderComments = (node: TreeNode, _style?: MoveStyle): string =>
  node.comments?.map(comment => comment.text).join('. ') ?? '';

export function renderMainline(
  nodes: TreeNode[],
  currentPath: string,
  style: MoveStyle,
  withComments = true,
): VNodeChildren {
  const children: VNodeChildren = [];
  let current = '';
  for (const node of nodes) {
    if (!node.uci) continue;
    current = path.append(current, node.id);
    children.push(
      h('move', { attrs: { p: current }, class: { active: current === currentPath } }, [
        node.ply % 2 ? `${Math.ceil(node.ply / 2)}. ` : '',
        renderMove(node.notation, node.uci, style),
      ]),
    );
    if (withComments) children.push(renderComments(node));
    children.push(', ');
    if (node.ply % 2 === 0) children.push(h('br'));
  }
  return children;
}
