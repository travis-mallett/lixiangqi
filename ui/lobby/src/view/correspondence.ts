import { h } from 'snabbdom';

import { bind, confirm } from 'lib/view';

import type LobbyController from '@/ctrl';
import type { Seek } from '@/interfaces';

import { offerHead, offerVariant, tds } from './util';

function renderSeek(ctrl: LobbyController, seek: Seek) {
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
      offerVariant(ctrl.opts.offerVariants, seek.variant?.key),
    ]),
  );
}

export default function (ctrl: LobbyController) {
  return h('table.hooks__list', [
    offerHead(),
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
      ctrl.data.seeks.map(seek => renderSeek(ctrl, seek)),
    ),
  ]);
}
