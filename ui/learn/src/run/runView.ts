import { h } from 'snabbdom';

import { bind } from 'lib/view';

import type { LearnCtrl } from '../ctrl';
import { mapSideView } from '../mapSideView';
import { progressView } from '../progressView';
import xiangqiBoard from '../xiangqiBoard';

export const runView = (ctrl: LearnCtrl) => {
  const run = ctrl.runCtrl;
  const { stage, level } = run;
  const boardContent =
    run.validation === 'ready'
      ? [
          xiangqiBoard(run),
          h('div.learn-board-caption', [
            h('span', 'Red moves from the bottom · pieces stand on intersections'),
            level.reading
              ? h('span.reading-chip', 'Guided reading')
              : h('span.move-chip', 'Play the gold-star move'),
          ]),
        ]
      : [
          h(
            `section.lesson-validation-state.${run.validation}`,
            { attrs: { 'aria-live': 'polite' } },
            run.validation === 'loading'
              ? [
                  h('span.validation-spinner'),
                  h('strong', 'Checking this lesson with the Xiangqi rules engine…'),
                ]
              : [
                  h('strong', 'This lesson position was rejected'),
                  h('p', run.validationError),
                  h('button.button', { hook: bind('click', run.retryValidation) }, 'Check again'),
                ],
          ),
        ];
  return h('div.learn.learn--run.xiangqi-learn-run', [
    h('div.learn__side', mapSideView(ctrl)),
    h('div.learn__main', boardContent),
    h('aside.learn__table', [
      h('div.wrap', [
        h('header.title', [
          h('img', { attrs: { src: stage.image, alt: '' } }),
          h('div.text', [
            h('span.lesson-code', stage.code),
            h('h2', stage.title),
            h('p.subtitle', stage.subtitle),
          ]),
        ]),
        h('div.lesson-copy', [
          h('span.level-kicker', `Lesson ${level.id} of ${stage.levels.length}`),
          h('h3', level.title),
          level.notation ? h('code.notation', level.notation) : null,
          h('p.goal', level.goal),
          h('p.explanation', level.explanation),
          level.culture
            ? h('blockquote.culture-note', [h('strong', 'Culture & language'), h('span', level.culture)])
            : null,
        ]),
        run.validation === 'loading'
          ? h('div.lesson-validation.pending', { attrs: { 'aria-live': 'polite' } }, 'Validating position…')
          : run.validation === 'invalid'
            ? h('div.result.failed', [
                h('strong', 'Lesson unavailable until its position passes Xiangqi validation.'),
                h('button.button', { hook: bind('click', run.retryValidation) }, 'Check again'),
              ])
            : run.failed
              ? h('div.result.failed', [
                  h('strong', 'That path does not match this example.'),
                  h('button.button', { hook: bind('click', run.restart) }, 'Reset position'),
                ])
              : run.completed
                ? h('div.result.completed', [
                    h('strong', run.stageCompleted() ? 'Course section complete' : 'Lesson complete'),
                    h(
                      'button.button',
                      { hook: bind('click', run.next) },
                      run.level.id < stage.levels.length ? 'Next lesson' : 'Next section',
                    ),
                  ])
                : level.reading
                  ? h(
                      'div.lesson-action',
                      h('button.button', { hook: bind('click', run.completeReading) }, 'I understand'),
                    )
                  : h('div.lesson-hint', [
                      h('span.target-star', '★'),
                      h('span', 'Follow the arrow to the gold star.'),
                    ]),
        progressView(run),
      ]),
    ]),
  ]);
};
