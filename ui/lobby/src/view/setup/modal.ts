import { timePickerAndSliders } from 'lib/setup/view/timeControl';
import { hl, type VNode, type LooseVNodes, snabDialog, spinnerVdom } from 'lib/view';

import type LobbyController from '@/ctrl';

import { advancedSettings } from './components/advancedSettings';
import { aiHistory } from './components/aiHistory';
import { colorButtons } from './components/colorButtons';
import { fenInput } from './components/fenInput';
import { levelButtons } from './components/levelButtons';
import { rulesetPicker } from './components/rulesetPicker';
import { variantPicker } from './components/variantPicker';

export default function setupModal(ctrl: LobbyController): VNode[] | null {
  const { setupCtrl } = ctrl;
  if (!setupCtrl.gameType) return null;
  const buttonText = {
    hook: i18n.site.createLobbyGame,
    friend: setupCtrl.friendUser ? i18n.site.challengeX(setupCtrl.friendUser) : i18n.site.challengeAFriend,
    ai: i18n.site.startTheChallenge,
  }[setupCtrl.gameType];
  const disabled = !setupCtrl.valid() || setupCtrl.loading;
  return [
    snabDialog({
      attrs: { dialog: { 'aria-labelledBy': 'lobby-setup-modal-title', 'aria-modal': 'true' } },
      class: `game-setup game-setup--${setupCtrl.gameType}`,
      css: [{ hashed: 'lobby.setup' }],
      onClose: () => {
        setupCtrl.closeModal = undefined;
        setupCtrl.gameType = null;
        setupCtrl.root.redraw();
      },
      modal: true,
      easyClose: 'clickOutside',
      vnodes: [
        hl('h2#lobby-setup-modal-title', i18n.site.gameSetup),
        hl('div.setup-content', views[setupCtrl.gameType](ctrl)),
        hl('div.footer', [
          hl(
            `button.button.button-metal.lobby__start__button.lobby__start__button--${setupCtrl.friendUser ? 'friend-user' : setupCtrl.gameType}`,
            {
              attrs: { disabled },
              class: { disabled },
              on: { click: setupCtrl.submit },
            },
            buttonText,
          ),
          setupCtrl.loading && spinnerVdom(),
        ]),
      ],
      onInsert: dlg => {
        setupCtrl.closeModal = dlg.close;
        dlg.show();
      },
    }),
  ].filter(v => v !== null);
}

const views = {
  hook: (ctrl: LobbyController): LooseVNodes => [
    variantPicker(ctrl.setupCtrl),
    timePickerAndSliders(ctrl.setupCtrl.timeControl, 0),
    colorButtons(ctrl.setupCtrl),
  ],
  friend: (ctrl: LobbyController): LooseVNodes => [
    rulesetPicker(ctrl),
    variantPicker(ctrl.setupCtrl),
    fenInput(ctrl.setupCtrl),
    timePickerAndSliders(ctrl.setupCtrl.timeControl, 0),
    colorButtons(ctrl.setupCtrl),
  ],
  ai: (ctrl: LobbyController): LooseVNodes => [
    levelButtons(ctrl.setupCtrl),
    advancedSettings(ctrl),
    aiHistory(ctrl.setupCtrl, ctrl),
  ],
};
