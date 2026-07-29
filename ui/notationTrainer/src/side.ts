import { h, type VNode } from 'snabbdom';

import { bind } from 'lib/view';
import { cmnToggleWrapProp } from 'lib/view/cmn-toggle';

import type NotationTrainerCtrl from './ctrl';
import type { BoardPerspective, Mode, MoveSide, NotationSystem, TimeControl } from './interfaces';

const timeControls: [TimeControl, string][] = [
  ['untimed', '∞'],
  ['thirtySeconds', '0:30'],
];

const radioGroup = <T extends string>(
  name: string,
  values: readonly T[],
  selected: T,
  label: (value: T) => string,
  change: (value: T) => void,
): VNode =>
  h(
    `form.${name}.buttons`,
    h(
      'group.radio',
      values.map(value =>
        h(`div.${name}_option`, [
          h('input', {
            attrs: {
              type: 'radio',
              id: `notation_${name}_${value}`,
              name,
              value,
              checked: value === selected,
            },
            on: { change: () => change(value) },
          }),
          h(`label.${name}_${value}`, { attrs: { for: `notation_${name}_${value}` } }, label(value)),
        ]),
      ),
    ),
  );

const setting = (title: string, control: VNode | VNode[]): VNode =>
  h('section.configuration-setting', [
    h('h2.setting-label', title),
    ...(Array.isArray(control) ? control : [control]),
  ]);

const moveSideLabel = (value: MoveSide): string =>
  i18n.notation[value === 'red' ? 'red' : value === 'black' ? 'black' : 'both'];

const perspectiveLabel = (value: BoardPerspective): string =>
  i18n.notation[value === 'red' ? 'redSide' : value === 'black' ? 'blackSide' : 'both'];

const configuration = (ctrl: NotationTrainerCtrl): VNode =>
  h('div.configuration', [
    setting(
      i18n.notation.trainingMode,
      radioGroup<Mode>(
        'mode',
        ['moveFromNotation', 'writeNotation'],
        ctrl.mode(),
        value => i18n.notation[value],
        value => ctrl.mode(value),
      ),
    ),
    setting(
      i18n.notation.notationSystem,
      radioGroup<NotationSystem>(
        'notationSystem',
        ['wxf', 'chinese'],
        ctrl.notationSystem(),
        value => i18n.notation[value === 'wxf' ? 'wxfNotation' : 'traditionalNotation'],
        value => ctrl.notationSystem(value),
      ),
    ),
    setting(
      i18n.notation.boardPerspective,
      radioGroup<BoardPerspective>(
        'boardPerspective',
        ['red', 'black', 'both'],
        ctrl.boardPerspective(),
        perspectiveLabel,
        value => ctrl.boardPerspective(value),
      ),
    ),
    setting(
      i18n.notation.sideToMove,
      radioGroup<MoveSide>('moveSide', ['red', 'black', 'both'], ctrl.moveSide(), moveSideLabel, value =>
        ctrl.moveSide(value),
      ),
    ),
    setting(
      i18n.notation.practiceTime,
      radioGroup<TimeControl>(
        'timeControl',
        timeControls.map(([value]) => value),
        ctrl.timeControl(),
        value => timeControls.find(([candidate]) => candidate === value)![1],
        value => ctrl.timeControl(value),
      ),
    ),
    h(
      'div.coordinate-toggle',
      cmnToggleWrapProp({
        id: 'notation-board-coordinates',
        name: i18n.notation.showBoardCoordinates,
        prop: ctrl.showBoardCoordinates,
      }),
    ),
  ]);

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const scoreCharts = (ctrl: NotationTrainerCtrl): VNode =>
  h(
    'div.box',
    h(
      'div.scores',
      [
        ['red', i18n.notation.averageScoreFromRedX, ctrl.modeScores[ctrl.mode()].red],
        ['black', i18n.notation.averageScoreFromBlackX, ctrl.modeScores[ctrl.mode()].black],
        ['both', i18n.notation.averageScoreFromBothX, ctrl.modeScores[ctrl.mode()].both],
      ].map(([perspective, format, scores]: [string, I18nFormat, number[]]) =>
        scores.length
          ? h('div.color-chart', [
              h('p', format.asArray(h('strong', average(scores).toFixed(2)))),
              h('div.sparkline-box', [
                h('svg.sparkline', {
                  attrs: { height: '80px', 'stroke-width': '3', id: `${perspective}-sparkline` },
                  hook: { insert: () => ctrl.updateCharts() },
                }),
                h('span.sparkline-tooltip', { attrs: { hidden: true } }),
              ]),
            ])
          : null,
      ),
    ),
  );

const scoreBox = (ctrl: NotationTrainerCtrl): VNode =>
  h('div.box.current-status', [h('h1', i18n.storm.score), h('div.score', ctrl.score)]);

const timeBox = (ctrl: NotationTrainerCtrl): VNode =>
  h('div.box.current-status', [
    h('h1', i18n.site.time),
    h('div.timer', { class: { hurry: ctrl.timeLeft <= 10_000 } }, (ctrl.timeLeft / 1000).toFixed(1)),
  ]);

const sideToMove = (ctrl: NotationTrainerCtrl): VNode | null =>
  ctrl.exercise
    ? h('div.box.current-status.side-to-move', [
        h('h1', i18n.notation.sideToMove),
        h('strong', ctrl.exercise.turn === 'red' ? i18n.notation.red : i18n.notation.black),
      ])
    : null;

const side = (ctrl: NotationTrainerCtrl): VNode =>
  h(
    'div.side',
    ctrl.playing
      ? [
          scoreBox(ctrl),
          !ctrl.timeDisabled() ? timeBox(ctrl) : null,
          sideToMove(ctrl),
          ctrl.isAuth && ctrl.hasModeScores() ? scoreCharts(ctrl) : null,
          ctrl.timeDisabled()
            ? h(
                'div.back',
                h('button.back-button.button', { hook: bind('click', ctrl.stop) }, i18n.study.back),
              )
            : null,
        ]
      : [
          ctrl.hasPlayed ? scoreBox(ctrl) : null,
          configuration(ctrl),
          ctrl.isAuth && ctrl.hasModeScores() ? scoreCharts(ctrl) : null,
        ],
  );

export default side;
