import { h, type VNode } from 'snabbdom';

import type MsgCtrl from '../ctrl';
import type { User } from '../interfaces';
import { glyph, iconButton } from './messageActions';

export default function renderInteract(ctrl: MsgCtrl, _user: User): VNode {
  const context = ctrl.editing ?? ctrl.replyTo;
  return h('div.msg-composer', [
    ctrl.submissionError ? h('p.msg-error', { attrs: { role: 'alert' } }, ctrl.submissionError) : undefined,
    context &&
      h('div.msg-compose-context', [
        glyph(ctrl.editing ? 'edit' : 'reply'),
        h('div', [h('strong', ctrl.editing ? i18n.inbox.editing : context.user), h('p', context.text)]),
        iconButton('close', i18n.inbox.cancel, () => {
          ctrl.cancelCompose();
          ctrl.redraw();
        }),
      ]),
    h(
      'form.msg-app__convo__post',
      {
        on: {
          submit: e => {
            e.preventDefault();
            void ctrl.post(ctrl.draft);
          },
        },
      },
      [
        ctrl.attachments ? ctrl.attachments.view('textarea', ctrl.redraw) : undefined,
        h('textarea.msg-app__convo__post__text', {
          attrs: {
            rows: 1,
            maxlength: 8000,
            enterkeyhint: 'send',
            placeholder: i18n.inbox.message,
            'aria-label': i18n.inbox.message,
            'data-testid': 'msg-textarea',
          },
          props: { value: ctrl.draft },
          on: {
            input: e => {
              const el = e.target as HTMLTextAreaElement;
              ctrl.updateDraft(el.value);
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            },
            keydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void ctrl.post(ctrl.draft);
              }
              if (e.key === 'Escape') {
                ctrl.cancelCompose();
                ctrl.redraw();
              }
            },
            blur: ctrl.stopTyping,
          },
        }),
        h(
          'button.msg-app__convo__post__submit',
          {
            attrs: {
              type: 'submit',
              disabled:
                (!ctrl.draft.trim() && !ctrl.attachments?.active) || ctrl.attachments?.ready === false,
              'aria-label': ctrl.editing ? i18n.inbox.save : i18n.inbox.send,
              'data-testid': 'msg-send-button',
            },
          },
          [glyph(ctrl.editing ? 'check' : 'send')],
        ),
      ],
    ),
  ]);
}
