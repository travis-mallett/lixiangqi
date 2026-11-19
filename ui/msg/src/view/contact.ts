import { h, type VNode } from 'snabbdom';

import { hookMobileMousedown } from 'lib/device';
import { globalChatId } from 'lib/inboxUrl';
import type { MaybeVNodes } from 'lib/view/snabbdom';
import { fullName } from 'lib/view/userLink';

import type MsgCtrl from '../ctrl';
import type { Contact, LastMsg, User } from '../interfaces';
import { glyph } from './icons';

export default function renderContact(ctrl: MsgCtrl, contact: Contact, active?: string): VNode {
  const user = contact.user,
    msg = contact.lastMsg,
    isNew = ctrl.mailbox.isUnread(contact);
  return h(
    'div.msg-app__side__contact',
    {
      key: user.id,
      class: { active: active === user.id },
      attrs: {
        role: 'button',
        tabindex: 0,
        'aria-label': user.name,
        'aria-current': String(active === user.id),
      },
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
          h(
            'div.msg-app__side__contact__date',
            user.id === globalChatId && !msg.id ? undefined : renderDate(msg),
          ),
        ]),
        h('div.msg-app__side__contact__body', [
          h(
            'div.msg-app__side__contact__msg',
            { class: { 'msg-app__side__contact__msg--new': isNew } },
            msg.deleted
              ? i18n.inbox.deleted
              : msg.text || (user.group && !msg.id ? user.name : i18n.site.mediaFiles),
          ),
          user.id !== globalChatId && msg.user === ctrl.data.me.id && msg.id
            ? glyph(msg.readAt || msg.read ? 'read' : msg.deliveredAt ? 'delivered' : 'sent')
            : undefined,
          ctrl.mailbox.state(user.id).pin ? glyph('pin') : undefined,
          ctrl.mailbox.state(user.id).mute ? glyph('mute') : undefined,
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
    user.group ? [glyph('group')] : ([...user.name][0]?.toLocaleUpperCase() ?? ''),
  );

const renderDate = (msg: LastMsg): VNode => {
  const date = msg.date,
    today = new Date(),
    lang = document.documentElement.lang || undefined;
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86400000,
  );
  const label =
    days === 0
      ? date.toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' })
      : days === 1
        ? new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-1, 'day')
        : date.toLocaleDateString(
            lang,
            days < 7
              ? { weekday: 'short' }
              : {
                  month: 'short',
                  day: 'numeric',
                  year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
                },
          );
  return h('time', { attrs: { title: date.toLocaleString(), datetime: date.toISOString() } }, label);
};
