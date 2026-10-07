import { aiLevelName, aiLevels } from 'lib/game';
import { nextAiLevel } from 'lib/game/aiProgress';
import { licon } from 'lib/licon';
import { bind, hl, onInsert } from 'lib/view';

import type LobbyController from '@/ctrl';

export default function botMap(ctrl: LobbyController) {
  const completed = ctrl.setupCtrl.botCompletedLevel();
  const next = nextAiLevel(completed);
  return hl('section.lobby__bot-map', [
    hl('header', [
      hl(
        'button.button.button-empty.text',
        {
          attrs: {
            type: 'button',
            'data-icon': licon.LessThan,
            'aria-label': i18n.site.backToHomepage,
            disabled: ctrl.setupCtrl.loading,
          },
          hook: bind(
            'click',
            () => {
              ctrl.botMapOpen = false;
            },
            ctrl.redraw,
          ),
        },
        i18n.site.backToHomepage,
      ),
      hl('h2', i18n.site.playAgainstComputer),
    ]),
    !ctrl.setupCtrl.botProgressReady()
      ? hl('div.lobby__bot-map__status', { attrs: { role: 'status' } }, [
          hl('p', ctrl.setupCtrl.aiStatsFailed ? i18n.site.statisticsUnavailable : i18n.site.loading),
          ctrl.setupCtrl.aiStatsFailed &&
            hl(
              'button.button.button-metal',
              {
                attrs: { type: 'button' },
                hook: bind('click', () => void ctrl.setupCtrl.loadAiStats()),
              },
              i18n.site.retry,
            ),
        ])
      : hl(
          'div.lobby__bot-map__scroll',
          {
            hook: onInsert(el => {
              centerBotLevel(el, next);
            }),
          },
          [
            hl(
              'ol.lobby__bot-map__levels',
              { attrs: { reversed: true, start: aiLevels.length } },
              [...aiLevels].reverse().map(level =>
                hl('li', { key: level }, [
                  hl(
                    'button.button.button-metal',
                    {
                      attrs: {
                        type: 'button',
                        'data-level': level,
                        'aria-label':
                          level <= completed
                            ? i18n.site.botLevelCleared(level)
                            : level > next
                              ? i18n.site.botLevelLocked(level)
                              : aiLevelName(level),
                        'aria-current': level === next && completed < aiLevels.length ? 'step' : false,
                        disabled: ctrl.setupCtrl.loading || level > next,
                      },
                      class: { cleared: level <= completed },
                      hook: bind('click', () => void ctrl.setupCtrl.startBot(level)),
                    },
                    [
                      hl('span', level.toString()),
                      (level <= completed || level > next) &&
                        hl('span.bot-status', {
                          attrs: {
                            'aria-hidden': 'true',
                            'data-icon': level <= completed ? licon.Checkmark : licon.Padlock,
                          },
                        }),
                    ],
                  ),
                ]),
              ),
            ),
          ],
        ),
    hl('footer', [
      hl(
        'button.button.button-metal',
        {
          attrs: { type: 'button', disabled: ctrl.setupCtrl.loading },
          hook: bind('click', () => ctrl.setupCtrl.openModal('ai'), ctrl.redraw),
        },
        i18n.site.challengeHigherLevel,
      ),
    ]),
  ]);
}

export function centerBotLevel(scroller: HTMLElement, level: number): void {
  const target = scroller.querySelector<HTMLElement>(`[data-level="${level}"]`);
  if (!target) return;
  const bounds = target.getBoundingClientRect();
  scroller.scrollTop +=
    bounds.top - scroller.getBoundingClientRect().top + bounds.height / 2 - scroller.clientHeight / 2;
}
