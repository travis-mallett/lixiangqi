import { Chessground } from 'chessgroundx/chessground';
import type { Key, Piece, Pieces } from 'chessgroundx/types';
import { opposite } from 'chessops';

import { type Player, type TopOrBottom, playable, xiangqiCgToUci, xiangqiUciMoveToCg } from 'lib/game';
import { plyToTurn } from 'lib/game/chess';
import { renderClock } from 'lib/game/clock/clockView';
import { renderSetting } from 'lib/nvui/setting';
import { formatClock as formatClockName } from 'lib/setup/timeControl';
import { type LooseVNodes, type VNode, hl, onInsert } from 'lib/view';

import renderCorresClock from '../corresClock/corresClockView';
import type RoundController from '../ctrl';
import { makeConfig as makeGroundConfig } from '../ground';
import type { Step } from '../interfaces';
import type { RoundNvuiContext } from '../round.nvui';
import { plyStep } from '../util';
import { renderResult } from './replay';
import { renderTableEnd, renderTablePlay, renderTableWatch } from './table';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
const ranks = ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'] as const;
const coordinateMove = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/i;

const roleNames: Record<string, string> = {
  'k-piece': 'general',
  'a-piece': 'advisor',
  'b-piece': 'elephant',
  'n-piece': 'horse',
  'r-piece': 'chariot',
  'c-piece': 'cannon',
  'p-piece': 'soldier',
};

const sideName = (color: Color): string => (color === 'white' ? 'Red' : 'Black');
const displayKey = (key: Key): string => xiangqiCgToUci(key);
const pieceName = (piece: Piece): string => `${sideName(piece.color)} ${roleNames[piece.role] ?? piece.role}`;

export function renderNvui(ctx: RoundNvuiContext): VNode {
  const { ctrl, notify, pageStyle, moveStyle } = ctx;
  notify.redraw = ctrl.redraw;

  if (!ctrl.chessground)
    ctrl.setChessground(
      Chessground(document.createElement('div'), {
        ...makeGroundConfig(ctrl),
        animation: { enabled: false },
        drawable: { enabled: false },
        coordinates: false,
      }),
    );

  const board = renderBoard(ctx);
  const actions = renderActions(ctrl);
  const content =
    pageStyle.get() === 'board-actions'
      ? [board, ctrl.isPlaying() && inputForm(ctx), actions]
      : [ctrl.isPlaying() && inputForm(ctx), actions, board];

  return hl('div.nvui', [
    hl('h1', gameText(ctrl)),
    gameInfo(ctx),
    ...content,
    hl('h2', i18n.nvui.moveList),
    hl(
      'p.moves',
      { attrs: { role: 'log', 'aria-live': 'off' } },
      renderMoves(ctrl.data.steps.slice(1), moveStyle.get()),
    ),
    hl('h2', i18n.nvui.lastMove),
    hl(
      'p.lastMove',
      { attrs: { 'aria-live': 'assertive', 'aria-atomic': 'true' } },
      renderMove(plyStep(ctrl.data, ctrl.ply), moveStyle.get()),
    ),
    hl('h2', i18n.nvui.pieces),
    renderPieceList(ctrl.chessground.state.boardState.pieces),
    hl('label', [noTrans('Move notation'), renderSetting(moveStyle, ctrl.redraw)]),
    hl('label', [noTrans('Page layout'), renderSetting(pageStyle, ctrl.redraw)]),
    notify.render(),
  ]);
}

function inputForm(ctx: RoundNvuiContext): VNode {
  const { ctrl, notify } = ctx;
  return hl(
    'form#move-form',
    {
      hook: onInsert(el => {
        const form = el as HTMLFormElement;
        const input = form.elements.namedItem('move') as HTMLInputElement;
        const submit = (stored = false) => {
          const raw = stored ? (ctrl.nvui?.premoveInput ?? '') : input.value;
          const move = raw.trim().toLowerCase();
          if (!stored) input.value = '';
          if (!coordinateMove.test(move)) {
            notify.set(`${i18n.nvui.invalidMove}: ${move || i18n.site.none}`);
            return;
          }
          if (ctrl.data.player.color !== ctrl.data.game.player) {
            if (ctrl.nvui) ctrl.nvui.premoveInput = move;
            notify.set(i18n.nvui.premoveRecorded(move));
            return;
          }
          if (!legalMove(ctrl, move)) {
            notify.set(`${i18n.nvui.invalidMove}: ${move}`);
            return;
          }
          ctrl.socket.send('move', { u: move }, { ackable: true });
          if (ctrl.nvui) ctrl.nvui.premoveInput = '';
        };
        form.addEventListener('submit', event => {
          event.preventDefault();
          submit();
        });
        if (ctrl.nvui) ctrl.nvui.submitMove = submit;
      }),
    },
    [
      hl('label', { attrs: { for: 'nvui-move' } }, noTrans('Move (for example h3h6 or a10a9)')),
      hl('input#nvui-move.move.mousetrap', {
        attrs: {
          name: 'move',
          type: 'text',
          inputmode: 'text',
          autocomplete: 'off',
          autofocus: true,
          pattern: '[a-iA-I](10|[1-9])[a-iA-I](10|[1-9])',
        },
      }),
      hl('button', { attrs: { type: 'submit' } }, noTrans('Play move')),
    ],
  );
}

function legalMove(ctrl: RoundController, uci: string): boolean {
  const [orig, dest] = xiangqiUciMoveToCg(uci);
  return ctrl.chessground.state.movable.dests?.get(orig)?.includes(dest) ?? false;
}

function gameInfo({ ctrl }: RoundNvuiContext): VNode {
  const clocks = [anyClock(ctrl, 'bottom'), anyClock(ctrl, 'top')];
  return hl('section.game-info', [
    hl('h2', i18n.nvui.gameInfo),
    hl('p', [noTrans('Red: '), playerHtml(ctrl, ctrl.playerByColor('white'))]),
    hl('p', [noTrans('Black: '), playerHtml(ctrl, ctrl.playerByColor('black'))]),
    hl(
      'p',
      `${ctrl.data.game.rated ? i18n.site.rated : i18n.site.casual} ${transGamePerf(ctrl.data.game.perf)}`,
    ),
    ctrl.data.clock
      ? hl(
          'p',
          `${i18n.site.clock}: ${formatClockName(
            `${ctrl.data.clock.initial / 60}+${ctrl.data.clock.increment}`,
            ctrl.data.game.moveTime,
          )}`,
        )
      : undefined,
    hl('h2', i18n.nvui.gameStatus),
    hl(
      'div.status',
      { attrs: { role: 'status', 'aria-live': 'assertive', 'aria-atomic': 'true' } },
      ctrl.data.game.status.name === 'started' ? i18n.site.playingRightNow : renderResult(ctrl),
    ),
    clocks.some(Boolean)
      ? hl('div.clocks', [
          hl('h2', i18n.nvui.yourClock),
          hl('div.botc', clocks[0]),
          hl('h2', i18n.nvui.opponentClock),
          hl('div.topc', clocks[1]),
        ])
      : undefined,
  ]);
}

function renderActions(ctrl: RoundController): VNode {
  return hl('section.actions', [
    hl('h2', i18n.nvui.actions),
    ctrl.data.player.spectator
      ? renderTableWatch(ctrl)
      : playable(ctrl.data)
        ? renderTablePlay(ctrl)
        : renderTableEnd(ctrl),
    hl(
      'button',
      {
        attrs: { type: 'button' },
        hook: onInsert(el =>
          (el as HTMLButtonElement).addEventListener('click', () => {
            ctrl.flip = !ctrl.flip;
            ctrl.redraw();
          }),
        ),
      },
      i18n.site.flipBoard,
    ),
  ]);
}

function renderBoard({ ctrl }: RoundNvuiContext): VNode {
  const pov = ctrl.flip ? opposite(ctrl.data.player.color) : ctrl.data.player.color;
  const orderedFiles = pov === 'black' ? [...files].reverse() : [...files];
  const orderedRanks = pov === 'black' ? [...ranks].reverse() : [...ranks];
  const pieces = ctrl.chessground.state.boardState.pieces;

  return hl('section.xiangqi-board', [
    hl('h2', i18n.site.board),
    hl(
      'table.board-wrapper',
      {
        attrs: {
          'aria-label': noTrans('Xiangqi board. Red is represented internally as white.'),
        },
      },
      [
        hl('thead', [
          hl('tr', [hl('td'), ...orderedFiles.map(file => hl('th', { attrs: { scope: 'col' } }, file))]),
        ]),
        hl(
          'tbody',
          orderedRanks.map(rank =>
            hl('tr', [
              hl('th', { attrs: { scope: 'row' } }, rank),
              ...orderedFiles.map(file => {
                const display = `${file}${rank}`;
                const key = xiangqiUciMoveToCg(`${display}${display}`)[0] as Key;
                const piece = pieces.get(key);
                return hl(
                  'td',
                  hl(
                    'button',
                    {
                      attrs: {
                        type: 'button',
                        'aria-label': piece ? `${display}: ${pieceName(piece)}` : `${display}: empty`,
                        disabled: true,
                      },
                    },
                    piece ? pieceName(piece) : '·',
                  ),
                );
              }),
            ]),
          ),
        ),
      ],
    ),
  ]);
}

function renderPieceList(pieces: Pieces): VNode {
  const bySide = (color: Color) =>
    [...pieces]
      .filter(([, piece]) => piece.color === color)
      .sort(([left], [right]) =>
        displayKey(left).localeCompare(displayKey(right), undefined, { numeric: true }),
      )
      .map(([key, piece]) => `${roleNames[piece.role] ?? piece.role} ${displayKey(key)}`)
      .join(', ');
  return hl('div.pieces', [
    hl('p', noTrans(`Red: ${bySide('white')}`)),
    hl('p', noTrans(`Black: ${bySide('black')}`)),
  ]);
}

function renderMoves(steps: Step[], style: string): LooseVNodes {
  return steps.flatMap(step => [
    step.ply & 1 ? `${plyToTurn(step.ply)}. ` : '',
    `${renderMove(step, style)}, `,
    step.ply % 2 === 0 ? hl('br') : undefined,
  ]);
}

function renderMove(step: Step, style: string): string {
  if (!step.san) return i18n.nvui.gameStart;
  return style === 'uci' ? (step.uci ?? step.san) : step.san;
}

function anyClock(ctrl: RoundController, position: TopOrBottom): VNode | undefined {
  const player = ctrl.playerAt(position);
  return (
    (ctrl.clock && renderClock(ctrl.clock, player.color, position, _ => [])) ||
    (ctrl.data.correspondence &&
      renderCorresClock(ctrl.corresClock!, player.color, position, ctrl.data.game.player))
  );
}

function playerHtml(ctrl: RoundController, player: Player): VNode | string {
  if (player.ai) return i18n.site.aiNameLevelAiLevel('Pikafish', player.ai);
  const user = player.user;
  const rating = player.rating ?? user?.perfs[ctrl.data.game.perf]?.rating;
  if (!user) return i18n.site.anonymous;
  return hl('span', [
    hl(
      'a',
      { attrs: { href: `/@/${user.username}` } },
      `${user.title ? `${user.title} ` : ''}${user.username}`,
    ),
    rating ? ` ${rating}` : '',
  ]);
}

function gameText(ctrl: RoundController): string {
  const playerSide = sideName(ctrl.data.player.color);
  return [
    ctrl.data.game.status.name === 'started'
      ? ctrl.isPlaying()
        ? `You play ${playerSide}`
        : 'Spectating'
      : i18n.site.gameOver,
    ctrl.data.game.rated ? i18n.site.rated : i18n.site.casual,
    transGamePerf(ctrl.data.game.perf),
  ].join(' ');
}

const transGamePerf = (perf: string): string => (i18n.site[perf as keyof typeof i18n.site] as string) || perf;
const noTrans = (text: string): string => text;
