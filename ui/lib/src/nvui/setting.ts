import { storage } from '../storage';
import { renderSan, renderPieceStyle, renderPrefixStyle } from './render';
import { makeSetting, type Setting } from './settings';
export { makeSetting, renderSetting, type Setting } from './settings';

const moveStyles = ['uci', 'san', 'literate', 'nato', 'anna'] as const;
export type MoveStyle = (typeof moveStyles)[number];
const pieceStyles = ['letter', 'white uppercase letter', 'name', 'white uppercase name'] as const;
export type PieceStyle = (typeof pieceStyles)[number];
const prefixStyles = ['letter', 'name', 'none'] as const;
export type PrefixStyle = (typeof prefixStyles)[number];
export type PositionStyle = 'before' | 'after' | 'none';
export type BoardStyle = 'plain' | 'table';
export type PageStyle = 'board-actions' | 'actions-board';

export function boardSetting(): Setting<BoardStyle> {
  return makeSetting<BoardStyle>({
    choices: [
      ['plain', 'plain: layout with no semantic rows or columns'],
      ['table', 'table: layout using a table with rank and file columns and row headers'],
    ],
    default: 'plain',
    storage: storage.make('nvui.boardLayout'),
  });
}

export function pageSetting(): Setting<PageStyle> {
  return makeSetting<PageStyle>({
    choices: [
      ['actions-board', `${i18n.nvui.actions} ${i18n.site.board}`],
      ['board-actions', `${i18n.site.board} ${i18n.nvui.actions}`],
    ],
    default: 'actions-board',
    storage: storage.make('nvui.pageLayout'),
  });
}

export function styleSetting(): Setting<MoveStyle> {
  return makeSetting<MoveStyle>({
    choices: moveStyles.map(s => [s, `${s}: ${renderSan('Nxf3', 'g1f3', s)}`]),
    default: 'literate',
    storage: storage.make('nvui.moveNotation'),
  });
}

export function pieceSetting(): Setting<PieceStyle> {
  return makeSetting<PieceStyle>({
    choices: pieceStyles.map(p => [p, `${p}: ${renderPieceStyle('P', p)}`]),
    default: 'white uppercase name',
    storage: storage.make('nvui.pieceStyle'),
  });
}

export function prefixSetting(): Setting<PrefixStyle> {
  return makeSetting<PrefixStyle>({
    choices: prefixStyles.map(p => [p, `${p}: ${renderPrefixStyle('white', p)}`]),
    default: 'name',
    storage: storage.make('nvui.prefixStyle'),
  });
}

export function positionSetting(): Setting<PositionStyle> {
  return makeSetting<PositionStyle>({
    choices: [
      ['before', 'before: c2: wp'],
      ['after', 'after: wp: c2'],
      ['none', 'none'],
    ],
    default: 'before',
    storage: storage.make('nvui.positionStyle'),
  });
}
