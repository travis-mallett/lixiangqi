import { enter, hl } from 'lib/view';

import type LobbyController from '@/ctrl';

const rulesets = [
  { key: 'tiantian-v1', name: i18n.site.xiangqiRulesTiantian },
  { key: 'unrestricted-v1', name: i18n.site.xiangqiRulesUnrestricted },
] as const;

export const rulesetPicker = (ctrl: LobbyController) => {
  const { setupCtrl } = ctrl;
  const currentRuleset = rulesets.find(ruleset => ruleset.key === setupCtrl.ruleset) ?? rulesets[0];
  const isOpen = setupCtrl.rulesetMenuOpen();
  const inputId = 'mselect-ruleset';
  const toggleRuleset = () => setupCtrl.toggleRulesetMenu();
  const selectRuleset = (key: (typeof rulesets)[number]['key']) => {
    setupCtrl.ruleset = key;
    toggleRuleset();
  };

  const children = [
    hl('input.mselect__toggle', {
      attrs: { type: 'checkbox', id: inputId, 'aria-label': i18n.site.xiangqiRules },
      on: { change: toggleRuleset },
    }),
    hl('label.mselect__label', { attrs: { for: inputId } }, [
      hl('span.variant-icon.variant-icon--standard'),
      hl('div.text', hl('span.name', currentRuleset.name)),
    ]),
  ];

  if (isOpen) {
    children.push(hl('label.fullscreen-mask', { on: { click: toggleRuleset } }));
    children.push(
      hl(
        'div.mselect__list',
        hl(
          'table',
          hl(
            'tbody',
            rulesets.map(ruleset =>
              hl(
                'tr.mselect__item',
                {
                  class: { current: ruleset.key === setupCtrl.ruleset },
                  attrs: { tabindex: '0' },
                  on: {
                    click: () => selectRuleset(ruleset.key),
                    keydown: enter(() => selectRuleset(ruleset.key)),
                  },
                },
                [hl('td.icon', hl('span.variant-icon.variant-icon--standard')), hl('td.name', ruleset.name)],
              ),
            ),
          ),
        ),
      ),
    );
  }

  return hl('div.mselect.ruleset-picker', { class: { mselect__active: isOpen } }, children);
};
