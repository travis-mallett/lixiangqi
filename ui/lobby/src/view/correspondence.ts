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
          const target = e.target as HTMLElement;
          const el = target.closest<HTMLElement>('tr');
          if (
            !el ||
            el.classList.contains('reserved') ||
            (el.dataset.kingdom && el.classList.contains('cancel') && !target.closest('button'))
          )
            return;

          if (!ctrl.me) {
            if (await confirm(i18n.site.youNeedAnAccountToDoThat, i18n.site.signUp, i18n.site.cancel))
              location.href = '/signup';
            return;
          }
          if (el.dataset['kingdom']) return ctrl.clickKingdomOffer(el.dataset['kingdom']);
          return ctrl.clickSeek(el.dataset['id']!);
        }),
      },
      [
        ...ctrl.data.seeks.map(seek => renderSeek(ctrl, seek)),
        ...(ctrl.kingdomOffers ?? []).map(o => {
          const own = o.creator === ctrl.me?.username.toLowerCase();
          const seated = ctrl.myKingdomOffer(o);
          const title = own ? i18n.site.cancel : seated ? ctrl.opts.waitingToStart : i18n.site.joinTheGame;
          return h(
            'tr.seek.' + (own ? 'cancel' : seated ? 'reserved' : 'join'),
            {
              key: 'kingdom-' + o.id,
              attrs: { 'data-kingdom': o.id, role: !seated ? 'button' : false, title },
            },
            tds([
              o.users.join(', '),
              '',
              i18n.site.nbDays(o.days),
              h('span', [
                [
                  i18n.site.threeKingdoms,
                  o.botLevel ? `${i18n.threeKingdoms.level} ${o.botLevel}` : `${o.users.length}/3`,
                ].join(' · '),
                own
                  ? h(
                      'button.button.button-empty.button-thin',
                      { attrs: { type: 'button' } },
                      i18n.site.cancel,
                    )
                  : null,
              ]),
            ]),
          );
        }),
      ],
    ),
  ]);
}
