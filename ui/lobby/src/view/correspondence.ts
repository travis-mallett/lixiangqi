import { h } from 'snabbdom';

import { bind, type MaybeVNodes, confirm } from 'lib/view';

import type LobbyController from '@/ctrl';
import type { Seek } from '@/interfaces';

import { tds } from './util';

function renderSeek(seek: Seek) {
  const klass = seek.action === 'joinSeek' ? 'join' : 'cancel';
  return h(
    'tr.seek.' + klass,
    {
      key: seek.id,
      attrs: {
        role: 'button',
        title: seek.action === 'joinSeek' ? i18n.site.joinTheGame : i18n.site.cancel,
        'data-id': seek.id,
      },
    },
    tds([
      h('span.ulpt', { attrs: { 'data-href': `/@/${seek.username}` } }, seek.username),
      seek.rank,
      seek.days ? i18n.site.nbDays(seek.days) : '∞',
    ]),
  );
}

function createSeek(ctrl: LobbyController) {
  if (ctrl.me && ctrl.data.seeks.length < 8)
    return h('div.create', [
      h(
        'button.button',
        {
          hook: bind(
            'click',
            () => ctrl.setupCtrl.openModal('hook', { variant: 'standard', timeMode: 'correspondence' }),
            ctrl.redraw,
          ),
        },
        i18n.site.createAGame,
      ),
    ]);
  return undefined;
}

export default function (ctrl: LobbyController): MaybeVNodes {
  return [
    h('table.hooks__list', [
      h(
        'thead',
        h(
          'tr',
          [i18n.site.player, i18n.site.rank, i18n.site.time].map(label => h('th', label)),
        ),
      ),
      h(
        'tbody',
        {
          hook: bind('click', async e => {
            let el = e.target as HTMLElement;
            do {
              el = el.parentNode as HTMLElement;
              if (el.nodeName === 'TR') {
                if (!ctrl.me) {
                  if (await confirm(i18n.site.youNeedAnAccountToDoThat, i18n.site.signUp, i18n.site.cancel))
                    location.href = '/signup';
                  return;
                }
                return ctrl.clickSeek(el.dataset['id']!);
              }
            } while (el.nodeName !== 'TABLE');
          }),
        },
        ctrl.data.seeks.map(renderSeek),
      ),
    ]),
    createSeek(ctrl),
  ];
}
