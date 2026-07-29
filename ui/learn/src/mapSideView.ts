import { h } from 'snabbdom';

import { bind, confirm } from 'lib/view';

import type { LearnCtrl } from './ctrl';
import { BASE_LEARN_PATH, hashHref } from './hashRouting';
import type { SideCtrl } from './sideCtrl';
import { categs } from './stage/list';

export function mapSideView(ctrl: LearnCtrl) {
  return ctrl.inStage() ? renderInStage(ctrl.sideCtrl) : renderHome(ctrl.sideCtrl);
}

function renderInStage(ctrl: SideCtrl) {
  return h('nav.learn__side-map', { attrs: { 'aria-label': 'Xiangqi curriculum' } }, [
    h('div.stages', [
      h('a.back', { attrs: { href: BASE_LEARN_PATH } }, [
        h('img', { attrs: { alt: '', src: site.asset.url('images/learn/xiangqi/board.svg') } }),
        h('span', 'Fundamentals of Xiangqi'),
      ]),
      ...categs.map((category, categoryId) =>
        h('div.categ', { class: { active: categoryId === ctrl.categId() } }, [
          h('h2', { hook: bind('click', () => ctrl.categId(categoryId)) }, category.name),
          h(
            'div.categ_stages',
            category.stages.map(stage => {
              const current = stage.id === ctrl.activeStageId();
              const done = !stage.comingSoon && ctrl.ctrl.isStageIdComplete(stage.id);
              const status = stage.comingSoon ? 'coming-soon' : current ? 'active' : done ? 'done' : 'future';
              const children = [
                h('img', { attrs: { src: stage.image, alt: '' } }),
                h('span', [h('strong', stage.code), h('span', stage.title)]),
              ];
              return stage.comingSoon
                ? h(`div.stage.${status}`, { attrs: { 'aria-disabled': 'true' } }, children)
                : h(`a.stage.${status}`, { attrs: { href: hashHref(stage.id) } }, children);
            }),
          ),
        ]),
      ),
    ]),
  ]);
}

function renderHome(ctrl: SideCtrl) {
  const progress = ctrl.progress();
  return h('aside.learn__side-home', [
    h('div.learn__side-home__header', [
      h('img.decoration', {
        attrs: {
          alt: 'Xiangqi board with river and palaces',
          src: site.asset.url('images/learn/xiangqi/board.svg'),
        },
      }),
      h('div.learn__side-home__title', [
        h('span.learn-badge', 'LEARN XIANGQI'),
        h('h1', 'Fundamentals of Xiangqi'),
        h('h2', 'Learn by playing'),
      ]),
    ]),
    h('p.side-intro', 'Enter the palaces, cross the river, and learn the game in its own language.'),
    h('div.progress', [
      h('div.text', `${progress}% complete`),
      h('div.bar', { style: { width: `${progress}%` } }),
    ]),
    progress > 0
      ? h(
          'div.actions',
          h(
            'button.confirm',
            {
              hook: bind('click', async () => {
                if (await confirm('Reset all Fundamentals of Xiangqi progress?')) ctrl.reset();
              }),
            },
            'Reset my progress',
          ),
        )
      : null,
  ]);
}
