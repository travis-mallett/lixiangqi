import { formatClock } from 'lib/setup/timeControl';
import { timePickerAndSliders } from 'lib/setup/view/timeControl';
import { hl, type VNode, type LooseVNodes, snabDialog, spinnerVdom } from 'lib/view';

import type LobbyController from '@/ctrl';

import { advancedSettings } from './components/advancedSettings';
import { aiHistory } from './components/aiHistory';
import { colorButtons } from './components/colorButtons';
import { fenInput } from './components/fenInput';
import { friendOpponent, kingdomOpponents, kingdomSide } from './components/kingdomSetup';
import { levelButtons } from './components/levelButtons';
import { variantPicker } from './components/variantPicker';

export default function setupModal(ctrl: LobbyController): VNode[] | null {
  const { setupCtrl } = ctrl;
  if (!setupCtrl.gameType) return null;
  const buttonText = {
    hook: i18n.site.createLobbyGame,
    friend: setupCtrl.isThreeKingdoms()
      ? i18n.threeKingdoms.friends
      : setupCtrl.friendUser
        ? i18n.site.challengeX(setupCtrl.friendUser)
        : i18n.site.challengeAFriend,
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
          setupCtrl.gameType === 'ai' &&
            hl(
              'p',
              setupCtrl.isThreeKingdoms()
                ? formatClock(`${setupCtrl.kingdomTime()}+0`, { seconds: setupCtrl.kingdomMoveTime() })
                : setupCtrl.timeControl.mode() === 'realTime'
                  ? formatClock(setupCtrl.timeControl.clockStr(), setupCtrl.timeControl.moveTime())
                  : setupCtrl.timeControl.mode() === 'correspondence'
                    ? `${i18n.site.correspondence} · ${i18n.site.nbDays(setupCtrl.timeControl.days())}`
                    : i18n.site.unlimited,
            ),
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
          setupCtrl.error && hl('p.error', { attrs: { role: 'alert' } }, setupCtrl.error),
        ]),
      ],
      onInsert: dlg => {
        setupCtrl.closeModal = dlg.close;
        dlg.show();
      },
    }),
  ].filter(v => v !== null);
}

const gameMode = (setup: LobbyController['setupCtrl']) =>
  setup.timeControl.mode() === 'correspondence'
    ? setup.ratedCorrespondence() && hl('p', i18n.site.rated)
    : setup.ratedPool() &&
      hl('div.label-select', [
        hl('label', { attrs: { for: 'sf_game_mode' } }, i18n.site.gameMode),
        hl(
          'select#sf_game_mode',
          {
            on: { change: (e: Event) => setup.setRated((e.target as HTMLSelectElement).value === 'rated') },
          },
          [
            hl('option', { attrs: { value: 'casual' }, props: { selected: !setup.rated } }, i18n.site.casual),
            hl('option', { attrs: { value: 'rated' }, props: { selected: setup.rated } }, i18n.site.rated),
          ],
        ),
      ]);

const views = {
  hook: (ctrl: LobbyController): LooseVNodes => [
    variantPicker(ctrl.setupCtrl),
    timePickerAndSliders(ctrl.setupCtrl.timeControl, 0),
    gameMode(ctrl.setupCtrl),
    ctrl.setupCtrl.isThreeKingdoms() ? kingdomSide(ctrl.setupCtrl) : colorButtons(ctrl.setupCtrl),
    ctrl.setupCtrl.isThreeKingdoms() && kingdomOpponents(ctrl.setupCtrl),
  ],
  friend: ({ setupCtrl: setup }: LobbyController): LooseVNodes => {
    const pool = setup.selectedRatedPool();
    return [
      variantPicker(setup),
      gameMode(setup),
      fenInput(setup),
      pool
        ? hl('div.label-select', [
            hl('label', { attrs: { for: 'sf_rated_clock' } }, i18n.site.timeControl),
            hl('output#sf_rated_clock', formatClock(`${pool.lim}+${pool.inc}`, pool.moveTime)),
          ])
        : timePickerAndSliders(setup.timeControl, 0),
      !pool && (setup.isThreeKingdoms() ? kingdomSide(setup) : colorButtons(setup)),
      setup.isThreeKingdoms()
        ? kingdomOpponents(setup)
        : (pool || setup.ratedCorrespondence()) && friendOpponent(setup, 'friendUser', i18n.site.opponent),
    ];
  },
  ai: (ctrl: LobbyController): LooseVNodes => [
    variantPicker(ctrl.setupCtrl),
    levelButtons(ctrl.setupCtrl),
    advancedSettings(ctrl),
    aiHistory(ctrl.setupCtrl, ctrl),
  ],
};
