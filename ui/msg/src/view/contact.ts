import { h, type VNode } from 'snabbdom';

import { hookMobileMousedown } from 'lib/device';
import { timeago } from 'lib/i18n';
import type { MaybeVNodes } from 'lib/view/snabbdom';
import { fullName } from 'lib/view/userLink';

import type MsgCtrl from '../ctrl';
import type { Contact, LastMsg, User } from '../interfaces';

export default function renderContact(ctrl: MsgCtrl, contact: Contact, active?: string): VNode {
  const user = contact.user,
    msg = contact.lastMsg,
    isNew = !msg.read && msg.user !== ctrl.data.me.id;
  return h(
    'div.msg-app__side__contact',
    {
      key: user.id,
      class: { active: active === user.id },
      attrs: { role: 'button', tabindex: 0, 'aria-label': user.name },
      on: {
        keydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void ctrl.openConvo(user.id);
          }
        },
      },
      hook: hookMobileMousedown(() => ctrl.openConvo(user.id)),
    },
    [
      userIcon(user, 'msg-app__side__contact__icon'),
      h('div.msg-app__side__contact__user', [
        h('div.msg-app__side__contact__head', [
          h('div.msg-app__side__contact__name', contactName(user, ctrl)),
          h('div.msg-app__side__contact__date', renderDate(msg)),
        ]),
        h('div.msg-app__side__contact__body', [
          h(
            'div.msg-app__side__contact__msg',
            { class: { 'msg-app__side__contact__msg--new': isNew } },
            msg.deleted ? i18n.inbox.deleted : msg.text,
          ),
          isNew ? h('span.msg-unread-dot', { attrs: { 'aria-label': i18n.inbox.message } }) : null,
        ]),
      ]),
    ],
  );
}

const contactName = (user: User, ctrl: MsgCtrl): MaybeVNodes =>
  ctrl.data.names[user.id] ? [ctrl.data.names[user.id]] : fullName(user);

export const userIcon = (user: User, cls: string): VNode =>
  h(
    'div.msg-avatar.' + cls,
    { class: { online: user.online }, attrs: { 'aria-hidden': 'true' } },
    [...user.name][0]?.toLocaleUpperCase() ?? '',
  );

const renderDate = (msg: LastMsg): VNode =>
  h(
    'time.timeago',
    { key: msg.date.getTime(), attrs: { title: msg.date.toLocaleString(), datetime: msg.date.getTime() } },
    timeago(msg.date),
  );
