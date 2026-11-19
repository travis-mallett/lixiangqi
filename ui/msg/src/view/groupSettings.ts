import { h, type VNode } from 'snabbdom';

import type MsgCtrl from '@/ctrl';
import type { Convo } from '@/interfaces';

import { iconButton } from './messageActions';
import { row } from './sidebar';

export default function groupSettings(ctrl: MsgCtrl, convo: Convo): VNode {
  const { mailbox } = ctrl;
  const admin = convo.admins?.includes(ctrl.data.me.id);
  function field(action: 'rename' | 'describe', label: string, value: string) {
    const name = action === 'rename';
    return h(
      'form.msg-group-field',
      {
        on: {
          submit: e => {
            e.preventDefault();
            const input = (e.target as HTMLFormElement).elements.namedItem(action) as
              | HTMLInputElement
              | HTMLTextAreaElement;
            void mailbox.manage(action, input.value);
          },
        },
      },
      [
        h(name ? 'input' : 'textarea', {
          attrs: {
            name: action,
            maxlength: name ? 64 : 480,
            required: name,
            placeholder: label,
            'aria-label': label,
          },
          hook: {
            insert: v => {
              (v.elm as HTMLInputElement | HTMLTextAreaElement).value = value;
            },
          },
        }),
        h('button', { attrs: { type: 'submit' } }, i18n.inbox.done),
      ],
    );
  }
  return h('div.msg-group-settings', [
    h('h2', i18n.inbox.groupSettings),
    admin ? field('rename', i18n.inbox.groupName, convo.user.name) : undefined,
    admin
      ? field('describe', i18n.inbox.groupDescription, convo.description ?? '')
      : convo.description
        ? h('p', convo.description)
        : undefined,
    ...(convo.members ?? []).map(u => {
      const memberAdmin = convo.admins?.includes(u.id);
      const canManage = admin && u.id !== ctrl.data.me.id;
      return h('div.msg-member', { key: u.id }, [
        h('span', [u.name, memberAdmin ? h('small', i18n.inbox.groupAdmin) : undefined]),
        canManage
          ? iconButton(
              'settings',
              memberAdmin ? i18n.inbox.removeAdmin : i18n.inbox.makeAdmin,
              () => void mailbox.manage(memberAdmin ? 'demote' : 'promote', u.id),
            )
          : undefined,
        canManage
          ? iconButton('close', i18n.inbox.removeMember, () => void mailbox.manage('remove', u.id))
          : undefined,
      ]);
    }),
    admin
      ? row(i18n.inbox.addMembers, 'plus', () => {
          ctrl.showSide();
          void mailbox.go('members');
        })
      : undefined,
    h('label', [
      h('input', {
        attrs: { type: 'checkbox' },
        props: { checked: mailbox.state(convo.user.id).mentions !== false },
        on: {
          change: e =>
            void mailbox.change(convo.user.id, 'mentions', String((e.target as HTMLInputElement).checked)),
        },
      }),
      i18n.inbox.notifyMentions,
    ]),
  ]);
}
