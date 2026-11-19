import { h, type VNode } from 'snabbdom';

import { hookMobileMousedown } from 'lib/device';
import { userLinkData } from 'lib/view/userLink';

import type MsgCtrl from '@/ctrl';
import type { Convo, User } from '@/interfaces';

import renderActions from './actions';
import { userIcon } from './contact';
import groupSettings from './groupSettings';
import { glyph } from './icons';
import renderInteract from './interact';
import { iconButton, showDetails, selectionBar } from './messageActions';
import renderMsgs from './msgs';

export default function renderConvo(ctrl: MsgCtrl, convo: Convo): VNode {
  const user = convo.user;
  return h('div.msg-app__convo', { key: user.id }, [
    h('div.msg-app__convo__head', [
      h('div.msg-app__convo__head__left', [
        h(
          'span.msg-app__convo__head__back',
          {
            hook: hookMobileMousedown(ctrl.showSide),
          },
          [glyph('prev')],
        ),
        user.group
          ? h(
              'button.msg-group-title',
              {
                on: {
                  click: () => {
                    ctrl.mailbox.openPanel('settings');
                  },
                },
              },
              [userIcon(user, 'msg-header-avatar'), user.name],
            )
          : contactLink(user, ctrl),
        convo.modDetails?.kid ? h('bad', 'KID') : undefined,
        convo.modDetails?.openInbox === false ? h('bad', "doesn't want messages") : undefined,
      ]),
      h('div.msg-app__convo__head__actions', renderActions(ctrl, convo)),
    ]),
    ctrl.mailbox.mode
      ? h('section.msg-panel', [
          iconButton('close', i18n.inbox.close, () => {
            ctrl.mailbox.openPanel();
          }),
          ctrl.mailbox.mode === 'search'
            ? h('input', {
                attrs: {
                  type: 'search',
                  placeholder: i18n.inbox.searchChat,
                  'aria-label': i18n.inbox.searchChat,
                },
                hook: { insert: v => (v.elm as HTMLElement).focus() },
                on: {
                  input: e => {
                    ctrl.mailbox.findMessages((e.target as HTMLInputElement).value);
                  },
                },
              })
            : ctrl.mailbox.mode === 'media'
              ? h('strong', i18n.inbox.allMedia)
              : groupSettings(ctrl, convo),
        ])
      : undefined,
    selectionBar(ctrl),
    convo.pinned.length
      ? h(
          'div.msg-pins',
          convo.pinned.map(msg =>
            h('button', { on: { click: () => showDetails(ctrl, msg) } }, [
              glyph('pin'),
              h('span', msg.text || i18n.site.mediaFiles),
            ]),
          ),
        )
      : null,
    ctrl.error ? h('div.msg-error', { attrs: { role: 'alert' } }, i18n.inbox.error) : null,
    !ctrl.connected() ? h('div.msg-offline', { attrs: { role: 'status' } }, i18n.inbox.offline) : null,
    renderMsgs(ctrl, convo),
    h('div.msg-app__convo__reply', [
      convo.relations.out === false || convo.relations.in === false
        ? blocked('This conversation is blocked.')
        : ctrl.data.me.bot
          ? blocked('Bot accounts cannot send nor receive messages.')
          : convo.postable
            ? renderInteract(ctrl, user)
            : blocked(`${user.name} doesn't accept new messages.`),
    ]),
  ]);
}

const contactLink = (user: User, ctrl: MsgCtrl): VNode => {
  return h('a.msg-chat-title', userLinkData(user), [
    userIcon(user, 'msg-header-avatar'),
    ctrl.data.names[user.id] ?? user.name,
  ]);
};

const blocked = (msg: string) => h('div.msg-app__convo__reply__block.text', [glyph('block'), msg]);
