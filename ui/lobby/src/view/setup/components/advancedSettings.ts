import { h } from 'snabbdom';

import type LobbyController from '@/ctrl';

import { aiTimeControls } from './aiTimeControls';
import { fenInput } from './fenInput';
import { rulesetPicker } from './rulesetPicker';
import { variantPicker } from './variantPicker';

export const advancedSettings = (ctrl: LobbyController) => {
  return h(
    'details.advanced-settings',
    {
      hook: {
        insert: vnode => {
          if (ctrl.setupCtrl.variant() === 'fromPosition') (vnode.elm as HTMLDetailsElement).open = true;
        },
      },
    },
    [
      h('summary', i18n.site.advancedSettings),
      h('div.advanced-settings__content', [
        variantPicker(ctrl.setupCtrl),
        rulesetPicker(ctrl),
        fenInput(ctrl.setupCtrl),
        aiTimeControls(ctrl.setupCtrl),
      ]),
    ],
  );
};
