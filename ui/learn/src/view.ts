import { h, type VNode } from 'snabbdom';

import type { LearnCtrl } from './ctrl';
import { hashHref } from './hashRouting';
import { mapSideView } from './mapSideView';
import { runView } from './run/runView';
import { categs } from './stage/list';

export const view = (ctrl: LearnCtrl): VNode => (ctrl.inStage() ? runView(ctrl) : mapView(ctrl));

const mapView = (ctrl: LearnCtrl) =>
  h('div.learn.learn--map.xiangqi-learn-map', [
    h('div.learn__side', mapSideView(ctrl)),
    h('main.learn__main.learn-stages', [
      h('section.learn-hero', [
        h('div', [
          h(
            'a.eyebrow',
            {
              attrs: {
                href: 'https://www.youtube.com/@ChineseChessOutLoud',
                target: '_blank',
                rel: 'noopener noreferrer',
              },
            },
            'Course Created by Chinese Chess Out Loud',
          ),
          h('h1', 'Fundamentals of Xiangqi'),
          h(
            'p',
            'A complete, interactive foundation in the board, pieces, rules, notation, tactics, and classical Chinese mating patterns.',
          ),
        ]),
        h('div.hero-seal', { attrs: { 'aria-hidden': 'true' } }, '象棋'),
      ]),
      ...categs.map(category =>
        h('section.categ', { attrs: { id: category.key } }, [
          h('header.categ-heading', [h('h2', category.name), h('p', category.description)]),
          h(
            'div.categ_stages',
            category.stages.map(stage => {
              const complete = !stage.comingSoon && ctrl.isStageIdComplete(stage.id);
              const progress = !stage.comingSoon ? ctrl.stageProgress(stage) : [0, 0];
              const body = [
                h('div.stage-icon', h('img', { attrs: { src: stage.image, alt: '' } })),
                h('div.text', [
                  h('span.stage-code', stage.code),
                  h('h3', stage.title),
                  h('p.subtitle', stage.subtitle),
                  stage.comingSoon
                    ? h('span.coming-soon-label', 'Coming Soon')
                    : h('span.lesson-count', `${progress[0]} / ${progress[1]} lessons`),
                ]),
                complete ? h('span.complete-mark', { attrs: { 'aria-label': 'Complete' } }, '✓') : null,
              ];
              return stage.comingSoon
                ? h('article.stage.coming-soon', { attrs: { 'aria-disabled': 'true' } }, body)
                : h(
                    `a.stage.${complete ? 'done' : 'available'}`,
                    { attrs: { href: hashHref(stage.id) } },
                    body,
                  );
            }),
          ),
        ]),
      ),
      h('section.learn-footer-note', [
        h('strong', 'A living curriculum'),
        h(
          'p',
          'The foundation and classical killing-method courses are playable now. The advanced roadmap remains visible so every lesson has a clear place as the system grows.',
        ),
      ]),
    ]),
  ]);
