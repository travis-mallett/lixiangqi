import { hl } from 'lib/view';

import type LobbyController from '@/ctrl';

export const rulesetPicker = ({ setupCtrl }: LobbyController) => {
  if (setupCtrl.usesVariantLevels()) return null;
  return hl('div.ruleset-picker.label-select', [
    hl('label', { attrs: { for: 'sf_ruleset' } }, i18n.site.xiangqiRules),
    hl(
      'select#sf_ruleset',
      {
        on: {
          change: (event: Event) => {
            setupCtrl.ruleset = (event.target as HTMLSelectElement).value;
            setupCtrl.root.redraw();
          },
        },
      },
      [
        ['tiantian-v1', i18n.site.xiangqiRulesTiantian],
        ['unrestricted-v1', i18n.site.xiangqiRulesUnrestricted],
      ].map(([key, name]) =>
        hl(
          'option',
          {
            attrs: { value: key },
            props: { selected: key === setupCtrl.ruleset },
          },
          name,
        ),
      ),
    ),
  ]);
};
