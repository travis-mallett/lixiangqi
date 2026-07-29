import { h } from 'snabbdom';

import { bind } from 'lib/view';

import { hashNavigate } from './hashRouting';
import type { RunCtrl } from './run/runCtrl';

export function progressView(ctrl: RunCtrl) {
  return h('nav.progress', { attrs: { 'aria-label': 'Lesson steps' } }, [
    ...ctrl.stage.levels.map(level => {
      const status = level.id === ctrl.level.id ? 'active' : ctrl.score(level) ? 'done' : 'future';
      return h(
        `a.${status}`,
        {
          attrs: {
            href: `/learn#/${ctrl.stage.id}/${level.id}`,
            'aria-label': `${level.id}. ${level.title}${status === 'done' ? ', complete' : ''}`,
          },
        },
        status === 'done' ? '✓' : String(level.id),
      );
    }),
    h('button.learn-step-back', { hook: bind('click', () => hashNavigate()) }, 'All lessons'),
  ]);
}
