import { h, type VNode } from 'snabbdom';

import { hookMobileMousedown } from 'lib/device';

import type MsgCtrl from '@/ctrl';
import type { SearchResult, User } from '@/interfaces';

import renderContacts, { userIcon } from './contact';
import { playerName } from './identity';

export function renderResults(ctrl: MsgCtrl, res: SearchResult): VNode {
  return h('div.msg-app__search.msg-app__side__content', [
    res.contacts[0] &&
      h('section', [
        h('h2', i18n.site.discussions),
        h(
          'div.msg-app__search__contacts',
          res.contacts.map(t => renderContacts(ctrl, t)),
        ),
      ]),
    res.friends[0] &&
      h('section', [
        h('h2', i18n.site.friends),
        h(
          'div.msg-app__search__users',
          res.friends.map(u => renderUser(ctrl, u)),
        ),
      ]),
    res.users[0] &&
      h('section', [
        h('h2', i18n.site.players),
        h(
          'div.msg-app__search__users',
          res.users.map(u => renderUser(ctrl, u)),
        ),
      ]),
  ]);
}

function renderUser(ctrl: MsgCtrl, user: User): VNode {
  return h(
    'div.msg-app__side__contact',
    { key: user.id, hook: hookMobileMousedown(() => ctrl.openConvo(user.id)) },
    [
      userIcon(user, 'msg-app__side__contact__icon'),
      h('div.msg-app__side__contact__user', [
        h('div.msg-app__side__contact__head', [h('div.msg-app__side__contact__name', [playerName(user)])]),
      ]),
    ],
  );
}
