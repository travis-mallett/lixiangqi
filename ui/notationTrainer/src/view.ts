import type { VNode } from 'snabbdom';

import { bind, hl, onInsert } from 'lib/view';

import notationBoard from './chessground';
import NotationTrainerCtrl, { DURATION } from './ctrl';
import side from './side';

const explanation = (ctrl: NotationTrainerCtrl): VNode =>
  hl('div.explanation.box', [
    hl('h1', i18n.notation.xiangqiNotation),
    hl('p', i18n.notation.notationIntroduction),
    hl('ul', [
      hl('li', i18n.notation.notationStructure),
      hl('li', i18n.notation.moveFromNotationExplanation),
      hl('li', i18n.notation.writeNotationExplanation),
    ]),
    hl('strong', i18n.notation[ctrl.mode()]),
    hl(
      'p',
      i18n.notation[ctrl.timeControl() === 'thirtySeconds' ? 'youHaveThirtySeconds' : 'goAsLongAsYouWant'],
    ),
  ]);

const prompt = (ctrl: NotationTrainerCtrl): VNode | false => {
  if (!ctrl.playing) return false;
  if (ctrl.error)
    return hl('div.notation-prompt.box.error', [
      hl('p', ctrl.error),
      hl('button.button', { hook: bind('click', () => void ctrl.loadExercise()) }, 'Retry'),
    ]);
  if (ctrl.loading) return hl('div.notation-prompt.box.loading', 'Loading…');
  return hl('div.notation-prompt.box', [
    hl(
      'span.prompt-label',
      ctrl.mode() === 'moveFromNotation' ? i18n.notation.playThisMove : i18n.notation.nameTheMove,
    ),
    ctrl.mode() === 'moveFromNotation'
      ? hl('strong.move-notation', ctrl.notation())
      : hl('span.move-question', '?'),
  ]);
};

const table = (ctrl: NotationTrainerCtrl): VNode =>
  hl('div.table', [
    !ctrl.hasPlayed && explanation(ctrl),
    !ctrl.playing &&
      hl('button.start.button.button-fat', { hook: bind('click', ctrl.start) }, i18n.notation.startTraining),
    prompt(ctrl),
  ]);

const progress = (ctrl: NotationTrainerCtrl): VNode =>
  hl(
    'div.progress',
    ctrl.hasPlayed &&
      hl('div.progress__bar', { style: { width: `${100 * (1 - ctrl.timeLeft / DURATION)}%` } }),
  );

const notationInput = (ctrl: NotationTrainerCtrl): VNode | false =>
  ctrl.mode() === 'writeNotation' &&
  hl(
    'form.notation-input',
    {
      on: {
        submit: (event: SubmitEvent) => {
          event.preventDefault();
          ctrl.submitNotation();
        },
      },
    },
    [
      hl('label', { attrs: { for: 'notation-answer' } }, i18n.notation.yourNotation),
      hl('input.keyboard', {
        attrs: {
          id: 'notation-answer',
          type: 'text',
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: 'false',
          placeholder: ctrl.notationPlaceholder(),
          disabled: !ctrl.playing || !ctrl.answerReady,
        },
        hook: onInsert<HTMLInputElement>(element => (ctrl.keyboardInput = element)),
        on: { keydown: ctrl.onKeyboardInputKeyDown },
      }),
      hl(
        'button.button',
        { attrs: { type: 'submit', disabled: !ctrl.playing || !ctrl.answerReady } },
        i18n.notation.checkAnswer,
      ),
    ],
  );

const view = (ctrl: NotationTrainerCtrl): VNode =>
  hl('div.trainer', { class: { wrong: ctrl.wrong } }, [
    side(ctrl),
    hl('div.main-board.xiangqi9x10', notationBoard(ctrl)),
    table(ctrl),
    progress(ctrl),
    notationInput(ctrl),
  ]);

export default view;
