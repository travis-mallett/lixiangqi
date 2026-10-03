import { coordinateMove } from '@lixiangqi/board';

import { defined } from 'lib';
import { view as cevalView, renderEval } from 'lib/ceval';
import { renderChat } from 'lib/chat/renderChat';
import { isTouchDevice } from 'lib/device';
import { aiLevelName } from 'lib/game';
import { plyToTurn } from 'lib/game/chess';
import { type XiangqiSide as Color, xiangqiSides as COLORS } from 'lib/game/xiangqi';
import { requestXiangqi } from 'lib/game/xiangqiApi';
import { accessibleBoard, positionText } from 'lib/nvui/board';
import { addBreaks } from 'lib/nvui/command';
import { liveText } from 'lib/nvui/notify';
import { renderSetting } from 'lib/nvui/settings';
import { renderMove, renderMainline, renderComments } from 'lib/nvui/xiangqi';
import { pubsub } from 'lib/pubsub';
import { formatClock as formatClockName } from 'lib/setup/timeControl';
import { ops, path as treePath } from 'lib/tree/tree';
import type { ClientEval } from 'lib/tree/types';
import { type VNode, type LooseVNodes, type VNodeChildren, hl, bind, noTrans, onInsert } from 'lib/view';
import { text as xhrText } from 'lib/xhr';

import type { AnalyseNvuiContext } from '../analyse.nvui';
import { createStudyBoard } from '../board';
import type AnalyseCtrl from '../ctrl';
import explorerView from '../explorer/explorerView';
import type { AnalyseData, Player } from '../interfaces';
import { clickHook, currentLineIndex, renderCurrentNode } from '../nvuiUtil';
import { renderRetro } from '../retrospect/nvuiRetroView';
import { view as chapterEditFormView } from '../study/chapterEditForm';
import { view as chapterNewFormView } from '../study/chapterNewForm';
import { playersView } from '../study/relay/relayPlayers';
import { showInfo as tourOverview } from '../study/relay/relayTourView';
import renderClocks from '../view/clocks';
import { renderResult, viewContext, type RelayViewContext } from '../view/components';

export function initNvui(ctx: AnalyseNvuiContext): void {
  const { ctrl, notify } = ctx;
  pubsub.on('analysis.server.progress', (data: AnalyseData) => {
    if (data.analysis && !data.analysis.partial) notify.set('Server-side analysis complete');
  });
  site.mousetrap.unbind('c');
  site.mousetrap.bind('c', () => notify.set(renderEvalAndDepth(ctrl)));
}

export function renderNvui(ctx: AnalyseNvuiContext): VNode {
  const { ctrl, deps, notify, moveStyle, pieceStyle, prefixStyle, positionStyle, boardStyle, pageStyle } =
    ctx;
  const d = ctrl.data,
    clocks = renderClocks(ctrl, ctrl.path);
  if (!ctrl.board || ctrl.cgVersion.dom !== ctrl.cgVersion.js) {
    ctrl.board?.destroy();
    const board = createStudyBoard(document.createElement('div'), ctrl);
    board.setPresentation({ ...board.getPresentation(), motion: { duration: 0 }, drawing: false });
    ctrl.setBoard(board);
  }
  const boardFirst = isTouchDevice() && pageStyle.get() === 'board-actions';

  if (boardFirst) {
    pieceStyle.set('name');
    prefixStyle.set('name');
    boardStyle.set('plain');
  }

  const boardView = [
    hl('h2', i18n.site.board),
    accessibleBoard(ctrl.board, notify.set, ctrl.bottomColor(), {
      pieceStyle: pieceStyle.get(),
      prefixStyle: prefixStyle.get(),
      positionStyle: positionStyle.get(),
      boardStyle: boardStyle.get(),
    }),
  ];

  return hl('main.analyse', [
    hl('div.nvui', [
      ...(boardFirst ? boardView : []),
      boardFirst && renderTouchDeviceCommands(ctx),
      studyDetails(ctrl),
      hl('h2', i18n.nvui.gameInfo),
      ...COLORS.map(color => hl('p', [`${i18n.site[color]}: `, renderPlayer(ctrl, playerByColor(d, color))])),
      hl('p', `${i18n.site[d.game.rated ? 'rated' : 'casual']} ${d.game.perf || d.game.variant.name}`),
      d.clock
        ? hl(
            'p',
            `Clock: ${formatClockName(`${d.clock.initial / 60}+${d.clock.increment}`, d.game.moveTime)}`,
          )
        : null,
      hl('h2', i18n.nvui.moveList),
      hl('p.moves', { attrs: { role: 'log', 'aria-live': 'off' } }, renderCurrentLine(ctx)),
      [
        hl(
          'button',
          {
            attrs: { 'aria-pressed': `${ctrl.explorer.enabled()}` },
            hook: bind('click', _ => ctrl.explorer.toggle(), ctrl.redraw),
          },
          i18n.site.openingExplorerAndTablebase,
        ),
        explorerView(ctrl),
      ],
      hl('h2', i18n.nvui.pieces),
      hl('p', positionText(ctrl.board)),
      renderAriaResult(ctrl),
      hl('h2', i18n.nvui.lastMove),
      !ctrl.retro && liveText(renderCurrentNode(ctx), 'polite', 'p.position.lastMove'),
      clocks &&
        hl('div.clocks', [
          hl('h2', i18n.site.clock),
          hl('div.clocks', [hl('div.topc', clocks[0]), hl('div.botc', clocks[1])]),
        ]),
      hl('h2', i18n.nvui.inputForm),
      hl(
        'form#move-form',
        {
          hook: onInsert<HTMLFormElement>(el => {
            const $form = $(el);
            const $input = $form.find('.move').val('');
            $form.on('submit', onSubmit(ctx, $input));
          }),
        },
        [
          hl('label', [
            i18n.nvui.inputForm,
            hl('input.move.mousetrap', {
              attrs: { name: 'move', type: 'text', autocomplete: 'off' },
            }),
          ]),
        ],
      ),
      notify.render(),
      renderRetro(ctx),
      !ctrl.retro && [
        hl('h2', i18n.site.computerAnalysis),
        cevalView.renderCeval(ctrl), // beware unsolicited redraws hosing the screen reader
        cevalView.renderPvs(ctrl),
        renderAcpl(ctx) || requestAnalysisBtn(ctx),
      ],
      ...(boardFirst ? [] : boardView),
      hl('div.boardstatus', { attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } }, ''),
      hl('div.content', {
        hook: onInsert(elem => {
          const $root = $(elem);
          $root.append($('.blind-content').removeClass('none'));
          $root.find('.copy-pgn').on('click', function (this: HTMLElement) {
            navigator.clipboard.writeText(this.dataset.pgn!).then(() => {
              notify.set(i18n.nvui.copiedToClipboard('PGN'));
            });
          });
          $root.find('.copy-fen').on('click', function (this: HTMLElement) {
            const fen = document.querySelector<HTMLInputElement>('.analyse__underboard__fen input')?.value;
            if (fen) {
              navigator.clipboard.writeText(fen).then(() => {
                notify.set(i18n.nvui.copiedToClipboard('FEN'));
              });
            }
          });
        }),
      }),
      hl('h2', i18n.site.advancedSettings),
      hl('label', ['Move notation', renderSetting(moveStyle, ctrl.redraw)]),
      hl('h3', 'Board settings'),
      hl('label', ['Piece style', renderSetting(pieceStyle, ctrl.redraw)]),
      hl('label', ['Piece prefix style', renderSetting(prefixStyle, ctrl.redraw)]),
      hl('label', ['Show position', renderSetting(positionStyle, ctrl.redraw)]),
      hl('label', ['Board layout', renderSetting(boardStyle, ctrl.redraw)]),
      hl('h2', i18n.site.keyboardShortcuts),
      hl(
        'p',
        [
          'Use arrow keys to navigate in the game.',
          `l: ${i18n.site.toggleLocalAnalysis}`,
          `z: ${i18n.site.toggleAllAnalysis}`,
          `space: ${i18n.site.playComputerMove}`,
          'c: announce computer evaluation',
          `x: ${i18n.site.showThreat}`,
        ].reduce(addBreaks, []),
      ),
      hl('h2', i18n.nvui.inputFormCommandList),
      hl(
        'p',
        [
          'Type these commands in the command input.',
          ...inputCommands
            .filter(c => !c.invalid?.(ctrl))
            .flatMap(command => [noTrans(`${command.cmd}: `), command.help]),
        ].reduce<VNodeChildren[]>(
          (acc, curr, i) => (i % 2 !== 0 ? addBreaks(acc, curr) : acc.concat(curr)),
          [],
        ),
      ),
      hl('h2', 'Chat'),
      ctrl.chatCtrl && renderChat(ctrl.chatCtrl),
      deps && ctrl.study?.relay && tourDetails(ctx),
    ]),
  ]);
}

function renderTouchDeviceCommands(ctx: AnalyseNvuiContext): LooseVNodes {
  const { notify, ctrl, moveStyle } = ctx;
  return [
    hl('div.actions', [
      hl('button', { hook: bind('click', ctrl.navigate.prev) }, 'previous move'),
      hl('button', { hook: bind('click', ctrl.navigate.next) }, 'next move'),
      hl('button', { hook: bind('click', () => notify.set(renderEvalAndDepth(ctrl))) }, 'evaluation'),
      hl(
        'button',
        { hook: bind('click', () => notify.set(renderBestMove({ ctrl, moveStyle } as AnalyseNvuiContext))) },
        'top engine move',
      ),
      hl(
        'button',
        {
          hook: bind('click', () => {
            notify.set(`${$('.nvui .botc').text()} - ${$('.nvui .topc').text()}`);
          }),
        },
        'clocks',
      ),
      hl('button', { hook: bind('click', ctrl.navigate.first) }, 'first move'),
      hl('button', { hook: bind('click', ctrl.navigate.last) }, 'last move'),
      hl(
        'button',
        { hook: bind('click', () => toggleLocalEvaluation(ctrl)) },
        noEvalStr(ctrl) ? noEvalStr(ctrl) : 'local evaluation is enabled',
      ),
    ]),
  ];
}

function renderEvalAndDepth(ctrl: AnalyseCtrl): string {
  if (ctrl.threatMode()) return `${evalInfo(ctrl.node.threat)} ${depthInfo(ctrl.node.threat, false)}`;
  const evs = { client: ctrl.getNode().ceval, server: ctrl.getNode().eval },
    bestEv = cevalView.getBestEval(ctrl);
  const evalStr = evalInfo(bestEv);
  return !evalStr ? noEvalStr(ctrl) : `${evalStr} ${depthInfo(evs.client, !!evs.client?.cloud)}`;
}

const evalInfo = (bestEv: EvalScore | undefined): string =>
  defined(bestEv?.cp)
    ? renderEval(bestEv.cp).replace('-', '−')
    : defined(bestEv?.mate)
      ? `mate in ${Math.abs(bestEv.mate)} for ${bestEv.mate > 0 ? 'red' : 'black'}`
      : '';

const depthInfo = (clientEv: ClientEval | undefined, isCloud: boolean): string =>
  clientEv ? `${i18n.site.depthX(clientEv.depth || 0)} ${isCloud ? 'Cloud' : ''}` : '';

const noEvalStr = (ctrl: AnalyseCtrl) =>
  !ctrl.isCevalAllowed()
    ? 'local evaluation not allowed'
    : !ctrl.cevalEnabled()
      ? 'local evaluation not enabled'
      : '';

function toggleLocalEvaluation(ctrl: AnalyseCtrl): void {
  if (ctrl.isCevalAllowed() && ctrl.ceval.analysable) ctrl.cevalEnabled(!ctrl.cevalEnabled());
}

function renderBestMove({ ctrl }: AnalyseNvuiContext): string {
  return noEvalStr(ctrl) || (ctrl.threatMode() ? ctrl.node.threat : ctrl.node.ceval)?.pvs[0]?.moves[0] || '';
}

function renderAriaResult(ctrl: AnalyseCtrl): VNode[] {
  const result = renderResult(ctrl);
  const res = result.length ? result : i18n.site.none;
  return [
    hl('h2', i18n.nvui.gameStatus),
    hl('div', { attrs: { role: 'status', 'aria-live': 'assertive', 'aria-atomic': 'true' } }, res),
  ];
}

function renderCurrentLine({ ctrl, moveStyle }: AnalyseNvuiContext) {
  if (ctrl.path.length === 0) return renderMainline(ctrl.mainline, ctrl.path, moveStyle.get(), !ctrl.retro);
  else {
    const child = ops.mainlineChild(ctrl.node);
    const futureNodes = child ? ops.mainlineNodeList(child) : [];
    return renderMainline(ctrl.nodeList.concat(futureNodes), ctrl.path, moveStyle.get(), !ctrl.retro);
  }
}

function onSubmit(ctx: AnalyseNvuiContext, $input: Cash) {
  const { ctrl, notify } = ctx;
  return async (e: SubmitEvent) => {
    e.preventDefault();
    const input = ($input.val() as string).trim();
    // Allow commands with/without a leading '/'
    const command = getCommand(input) || getCommand(input.slice(1));
    if (command && !command.invalid?.(ctrl)) command.cb(ctx, input);
    else {
      const tree = ctrl.tree,
        path = ctrl.path;
      try {
        const resolved = await requestXiangqi<{ move: string }>('/api/analysis/notation-move', {
          ...tree.positionAt(path),
          notation: input,
        });
        if (ctrl.tree !== tree || ctrl.path !== path) return;
        const [from, to] = coordinateMove(resolved.move);
        ctrl.sendMove(from, to);
      } catch (error) {
        notify.set(error instanceof Error ? error.message : String(error));
      }
    }
    $input.val('');
  };
}

type Command = 'b' | 'p' | 's' | 'eval' | 'best' | 'prev' | 'next' | 'prev line' | 'next line';
type InputCommand = {
  cmd: Command;
  help: VNode | string;
  cb: (ctrl: AnalyseNvuiContext, input: string) => void;
  invalid?: (ctrl: AnalyseCtrl) => boolean;
};

const inputCommands: InputCommand[] = [
  ...(['b', 'p', 's'] as const).map(cmd => ({
    cmd,
    help: i18n.nvui.pieces,
    cb: ({ ctrl, notify }: AnalyseNvuiContext, input: string) =>
      notify.set(positionText(ctrl.board, input.split(' ').slice(1).join(' ').trim()) || i18n.site.none),
  })),
  {
    cmd: 'eval',
    help: noTrans("announce last move's computer evaluation"),
    cb: ({ ctrl, notify }) => notify.set(renderEvalAndDepth(ctrl)),
  },
  {
    cmd: 'best',
    help: noTrans('announce the top engine move'),
    cb: ctx => ctx.notify.set(renderBestMove(ctx)),
  },
  {
    cmd: 'prev',
    help: noTrans('return to the previous move'),
    cb: ({ ctrl }) => doAndRedraw(ctrl, ctrl.navigate.prev),
  },
  {
    cmd: 'next',
    help: noTrans('go to the next move'),
    cb: ({ ctrl }) => doAndRedraw(ctrl, ctrl.navigate.next),
  },
  {
    cmd: 'prev line',
    help: noTrans('switch to the previous variation'),
    cb: ({ ctrl }) => doAndRedraw(ctrl, jumpPrevLine),
  },
  {
    cmd: 'next line',
    help: noTrans('switch to the next variation'),
    cb: ({ ctrl }) => doAndRedraw(ctrl, jumpNextLine),
  },
];

const getCommand = (input: string) => {
  const split = input.split(' ');
  const firstWordLowerCase = split[0].toLowerCase();
  return (
    inputCommands.find(c => c.cmd === input.toLowerCase()) ||
    inputCommands.find(c => split.length !== 1 && c.cmd === firstWordLowerCase)
  ); // 'next line' should not be interpreted as 'next'
};

const analysisGlyphs = new Set(['?!', '?', '??']);

function renderAcpl({ ctrl, moveStyle }: AnalyseNvuiContext): LooseVNodes {
  const analysis = ctrl.data.analysis;
  if (!analysis || ctrl.retro) return undefined;
  const analysisNodes = ctrl.mainline.filter(n => n.glyphs?.find(g => analysisGlyphs.has(g.symbol)));
  const res: Array<VNode> = [];
  COLORS.forEach(color => {
    res.push(hl('h3', `${color} player: ${analysis[color].acpl} ${i18n.site.averageCentipawnLoss}`));
    res.push(
      hl(
        'select',
        {
          hook: bind(
            'change',
            e => ctrl.jumpToMain(parseInt((e.target as HTMLSelectElement).value)),
            ctrl.redraw,
          ),
        },
        analysisNodes
          .filter(n => (n.ply % 2 === 1) === (color === 'red'))
          .map(node =>
            hl(
              'option',
              { attrs: { value: node.ply, selected: node.ply === ctrl.node.ply } },
              [
                plyToTurn(node.ply),
                renderMove(node.notation, node.uci, moveStyle.get()),
                renderComments(node, moveStyle.get()),
              ].join(' '),
            ),
          ),
      ),
    );
  });
  return res;
}

const requestAnalysisBtn = ({ ctrl, notify, analysisInProgress }: AnalyseNvuiContext) => {
  if (ctrl.ongoing || ctrl.synthetic || ctrl.hasFullComputerAnalysis()) return undefined;
  return analysisInProgress()
    ? hl('p', 'Server-side analysis in progress')
    : hl(
        'button.request-analysis',
        clickHook(() =>
          xhrText(`/${ctrl.data.game.id}/request-analysis`, { method: 'post' }).then(
            () => {
              analysisInProgress(true);
              notify.set('Server-side analysis in progress');
            },
            () => notify.set('Cannot run server-side analysis'),
          ),
        ),
        i18n.site.requestAComputerAnalysis,
      );
};

const renderPlayer = (ctrl: AnalyseCtrl, player: Player): LooseVNodes =>
  player.ai ? aiLevelName(player.ai) : userHtml(ctrl, player);

function userHtml(ctrl: AnalyseCtrl, player: Player) {
  const d = ctrl.data,
    user = player.user,
    perf = user ? user.perfs[d.game.perf] : null,
    rating = player.rating ?? perf?.rating,
    rd = player.ratingDiff,
    ratingDiff = rd ? (rd > 0 ? '+' + rd : rd < 0 ? '−' + -rd : '') : '';
  const studyPlayers = ctrl.study && renderStudyPlayer(ctrl, player.color);
  return user
    ? hl('span', [
        hl(
          'a',
          { attrs: { href: '/@/' + user.username } },
          user.title ? `${user.title} ${user.username}` : user.username,
        ),
        rating ? ` ${rating}` : ``,
        ' ' + ratingDiff,
      ])
    : studyPlayers || hl('span', i18n.site.anonymous);
}

function renderStudyPlayer({ study }: AnalyseCtrl, color: Color): VNode | undefined {
  const player = study?.currentChapter().players?.[color];
  const keys = [
    ['name', i18n.site.name],
    ['title', 'title'],
    ['rating', i18n.site.rating],
    ['fed', 'fed'],
    ['team', 'team'],
  ] as const;
  return (
    player &&
    hl(
      'span',
      keys
        .reduce<string[]>(
          (strs, [key, i18n]) =>
            player[key]
              ? strs.concat(`${i18n}: ${key === 'fed' ? player[key].i18nName : player[key]}`)
              : strs,
          [],
        )
        .join(' '),
    )
  );
}

const playerByColor = (d: AnalyseData, color: Color): Player =>
  color === d.player.color ? d.player : d.opponent;

const jumpNextLine = (ctrl: AnalyseCtrl) => jumpLine(ctrl, 1);
const jumpPrevLine = (ctrl: AnalyseCtrl) => jumpLine(ctrl, -1);

function jumpLine(ctrl: AnalyseCtrl, delta: number) {
  const { i, of } = currentLineIndex(ctrl);
  if (of === 1) return;
  const newI = (i + delta + of) % of;
  const prevPath = treePath.init(ctrl.path);
  const prevNode = ctrl.tree.nodeAtPath(prevPath);
  const newPath = treePath.append(prevPath, prevNode.children[newI].id);
  ctrl.userJumpIfCan(newPath);
}

const redirectToSelectedHook = bind('change', (e: InputEvent) => {
  const target = e.target as HTMLSelectElement;
  const selectedOption = target.options[target.selectedIndex];
  const url = selectedOption.getAttribute('url');
  if (url) window.location.href = url;
});

function tourDetails({ ctrl, deps }: AnalyseNvuiContext): VNode[] {
  const ctx: RelayViewContext = { ...viewContext(ctrl, deps), allowVideo: false } as RelayViewContext;
  const tour = ctx.relay.data.tour;
  ctx.relay.redraw = ctrl.redraw;

  return [
    hl('h1', 'Tour details'),
    hl('h2', 'Overview'),
    hl('div', tourOverview(tour.info, tour.dates)),
    hl('h2', 'Players'),
    hl(
      'button.tournament-players',
      clickHook(() => ctx.relay.tab('players'), ctrl.redraw),
      'Load player list',
    ),
    hl('div', ctx.relay.tab() === 'players' && playersView(ctx.relay.players)),
  ];
}

function studyDetails({ study, redraw }: AnalyseCtrl) {
  const relayGroups = study?.relay?.data.group;
  const relayRounds = study?.relay?.data.rounds;
  const tour = study?.relay?.data.tour;
  const hash = window.location.hash;
  return (
    study &&
    hl('div.study-details', [
      hl('h2', 'Study details'),
      hl('span', `Title: ${study.data.name}. By: ${study.data.ownerId}`),
      hl('br'),
      relayGroups &&
        hl(
          'div.relay-groups',
          hl('label', [
            'Current group:',
            hl(
              'select',
              {
                attrs: { autofocus: hash === '#group-select' },
                hook: redirectToSelectedHook,
              },
              relayGroups.tours.map(t =>
                hl(
                  'option',
                  { attrs: { selected: t.id === tour?.id, url: `/broadcast/-/${t.id}#group-select` } },
                  t.name,
                ),
              ),
            ),
          ]),
        ),
      tour &&
        relayRounds &&
        hl(
          'div.relay-rounds',
          hl('label', [
            'Current round:',
            hl(
              'select',
              {
                attrs: { autofocus: hash === '#round-select' },
                hook: redirectToSelectedHook,
              },
              relayRounds.map(r =>
                hl(
                  'option',
                  {
                    attrs: {
                      selected: r.id === study.data.id,
                      url: `/broadcast/${tour.slug}/${r.slug}/${r.id}#round-select`,
                    },
                  },
                  study.relay?.round.name,
                ),
              ),
            ),
          ]),
        ),
      hl('div.chapters', [
        hl('label', [
          'Current chapter:',
          hl(
            'select',
            {
              attrs: { id: 'chapter-select' },
              hook: bind('change', (e: InputEvent) => {
                const target = e.target as HTMLSelectElement;
                const selectedOption = target.options[target.selectedIndex];
                const chapterId = selectedOption.getAttribute('chapterId');
                study.setChapter(chapterId!);
              }),
            },
            study.chapters.list
              .all()
              .map((ch, i) =>
                hl(
                  'option',
                  { attrs: { selected: ch.id === study.currentChapter().id, chapterId: ch.id } },
                  `${i + 1}. ${ch.name}`,
                ),
              ),
          ),
        ]),
        study.members.canContribute()
          ? hl('div.buttons', [
              hl(
                'button.edit-chapter',
                clickHook(() => study.chapters.editForm.toggle(study.currentChapter()), redraw),
                [
                  'Edit current chapter',
                  study.chapters.editForm.current() && chapterEditFormView(study.chapters.editForm),
                ],
              ),
              hl(
                'button.create-chapter',
                clickHook(() => study.chapters.newForm.toggle(), redraw),
                [
                  'Add new chapter',
                  study.chapters.newForm.isOpen() ? chapterNewFormView(study.chapters.newForm) : undefined,
                ],
              ),
            ])
          : undefined,
      ]),
    ])
  );
}

const doAndRedraw = (ctrl: AnalyseCtrl, fn: (ctrl: AnalyseCtrl) => void): void => {
  fn(ctrl);
  ctrl.redraw();
};
