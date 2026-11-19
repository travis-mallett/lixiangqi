import { h, type VNode } from 'snabbdom';

import type MsgCtrl from '@/ctrl';
import type { Convo } from '@/interfaces';

import { playerName } from './identity';
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
    ...(admin
      ? [
          h('label', [
            h('input', {
              attrs: { type: 'checkbox' },
              props: { checked: convo.adminAddOnly !== false },
              on: {
                change: e =>
                  void mailbox.manage('adminAddOnly', String((e.target as HTMLInputElement).checked)),
              },
            }),
            i18n.inbox.adminAddOnly,
          ]),
          h('h3', i18n.inbox.groupLink),
          ...(convo.inviteToken
            ? [
                h('input', {
                  attrs: { readonly: true, 'aria-label': i18n.inbox.groupLink },
                  props: {
                    value: location.origin + '/inbox/invite/' + convo.user.id + '/' + convo.inviteToken,
                  },
                  on: { focus: e => (e.target as HTMLInputElement).select() },
                }),
                row(
                  i18n.inbox.copy,
                  'copy',
                  () =>
                    void navigator.clipboard.writeText(
                      location.origin + '/inbox/invite/' + convo.user.id + '/' + convo.inviteToken,
                    ),
                ),
                row(i18n.inbox.resetLink, 'settings', () => void mailbox.manage('linkReset')),
                row(i18n.inbox.disableLink, 'close', () => void mailbox.manage('linkOff')),
                h('label', [
                  h('input', {
                    attrs: { type: 'checkbox' },
                    props: { checked: !!convo.approval },
                    on: {
                      change: e =>
                        void mailbox.manage('approval', String((e.target as HTMLInputElement).checked)),
                    },
                  }),
                  i18n.inbox.requireApproval,
                ]),
                ...(convo.requests ?? []).map(id =>
                  h('div.msg-member', [
                    playerName(id),
                    row(i18n.site.accept, 'check', () => void mailbox.manage('approve', id)),
                    row(i18n.site.decline, 'close', () => void mailbox.manage('decline', id)),
                  ]),
                ),
              ]
            : [row(i18n.site.enable, 'plus', () => void mailbox.manage('linkOn'))]),
        ]
      : []),
    ...(convo.members ?? []).map(u => {
      const memberAdmin = convo.admins?.includes(u.id);
      const canManage = admin && u.id !== ctrl.data.me.id;
      return h('div.msg-member', { key: u.id }, [
        h('span', [playerName(u), memberAdmin ? h('small', i18n.inbox.groupAdmin) : undefined]),
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
    admin || convo.adminAddOnly === false
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
