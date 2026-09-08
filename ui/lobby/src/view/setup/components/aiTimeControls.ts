import { h } from 'snabbdom';

import { timePickerAndSliders } from 'lib/setup/view/timeControl';

import type SetupController from '@/setupCtrl';

export const aiTimeControls = (ctrl: SetupController) =>
  h('section.ai-time-controls', { class: { expanded: ctrl.aiTimeControls } }, [
    h('label.ai-time-controls__toggle', { attrs: { for: 'ai-time-controls' } }, [
      h('input#ai-time-controls', {
        attrs: { type: 'checkbox', 'aria-expanded': ctrl.aiTimeControls.toString() },
        props: { checked: ctrl.aiTimeControls },
        on: {
          change: (event: Event) => ctrl.setAiTimeControls((event.target as HTMLInputElement).checked),
        },
      }),
      h('strong', i18n.site.timeControls),
    ]),
    ...(ctrl.aiTimeControls
      ? [
          h('div.ai-time-controls__panel', [
            timePickerAndSliders(ctrl.timeControl, ctrl.minimumTimeIfReal(), ['realTime', 'correspondence']),
          ]),
        ]
      : []),
  ]);
