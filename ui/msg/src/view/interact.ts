import { h, type VNode } from 'snabbdom';

import type MsgCtrl from '../ctrl';
import type { User } from '../interfaces';
import { glyph } from './icons';
import { playerName } from './identity';
import { iconButton, showEmoji } from './messageActions';

// The Signal Desktop scroller is 30–70px inside a 1px border, with 6px block insets.
const composerWidths = new WeakMap<HTMLTextAreaElement, ResizeObserver>();

function fitComposer(input: HTMLTextAreaElement) {
  input.style.height = 'auto';
  input.style.overflowY = 'hidden';
  const height = input.scrollHeight;
  const max = parseFloat(window.getComputedStyle(input).maxHeight);
  input.style.height = Math.min(height, max) + 'px';
  if (height > max) input.style.overflowY = 'auto';
}

export default function renderInteract(ctrl: MsgCtrl, _user: User): VNode {
  const context = ctrl.editing ?? ctrl.replyTo;
  const mention = ctrl.data.convo?.members && /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(ctrl.draft);
  return h('div.msg-composer', [
    ctrl.submissionError ? h('p.msg-error', { attrs: { role: 'alert' } }, ctrl.submissionError) : undefined,
    ctrl.preview.value && ctrl.preview.forSend(ctrl.draft)
      ? h('div.msg-staged-preview', [
          ctrl.preview.value.image && h('img', { attrs: { src: ctrl.preview.value.image, alt: '' } }),
          h('div', [
            h('strong', ctrl.preview.value.meta.title),
            h('p', ctrl.preview.value.meta.description),
            h('small', new URL(ctrl.preview.value.meta.url).hostname),
          ]),
          iconButton('close', i18n.inbox.removePreview, () => ctrl.preview.dismiss()),
        ])
      : undefined,
    context &&
      h('div.msg-compose-context', [
        glyph(ctrl.editing ? 'edit' : 'reply'),
        h('div', [
          h('strong', ctrl.editing ? i18n.inbox.editing : [playerName(context.user)]),
          h('p', context.text || i18n.site.mediaFiles),
        ]),
        iconButton('close', i18n.inbox.cancel, () => {
          ctrl.cancelCompose();
          ctrl.redraw();
        }),
      ]),
    mention
      ? h(
          'div.msg-mentions',
          (ctrl.data.convo?.members ?? [])
            .filter(
              u => u.id !== ctrl.data.me.id && u.name.toLowerCase().startsWith(mention[1].toLowerCase()),
            )
            .map(u =>
              h(
                'button',
                {
                  attrs: { 'aria-label': '@' + u.name },
                  on: {
                    mousedown: e => e.preventDefault(),
                    click: () => {
                      ctrl.updateDraft(
                        ctrl.draft.slice(0, ctrl.draft.length - mention[1].length) + u.name + ' ',
                      );
                      document.querySelector<HTMLTextAreaElement>('.msg-composer textarea')?.focus();
                    },
                  },
                },
                ['@', playerName(u)],
              ),
            ),
        )
      : undefined,
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
        iconButton('smiley', i18n.inbox.addEmoji, () => {
          const input = document.querySelector<HTMLTextAreaElement>('.msg-composer textarea');
          if (!input) return;
          const start = input.selectionStart,
            end = input.selectionEnd,
            original = input.value;
          void showEmoji(i18n.inbox.addEmoji, emoji => {
            if (
              !input.isConnected ||
              input.value !== original ||
              original.length - (end - start) + emoji.length > input.maxLength
            )
              return;
            input.setRangeText(emoji, start, end, 'end');
            fitComposer(input);
            ctrl.updateDraft(input.value);
            requestAnimationFrame(() => input.focus());
          });
        }),
        h('div.msg-app__convo__post__input', [
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
            hook: {
              insert(vnode) {
                const input = vnode.elm as HTMLTextAreaElement;
                let width = -1;
                const observer = new ResizeObserver(([entry]) => {
                  if (entry.contentRect.width === width) return;
                  width = entry.contentRect.width;
                  fitComposer(input);
                });
                composerWidths.set(input, observer);
                observer.observe(input.parentElement!);
                fitComposer(input);
              },
              postpatch(old, vnode) {
                if (old.data?.props?.value !== vnode.data?.props?.value)
                  fitComposer(vnode.elm as HTMLTextAreaElement);
              },
              destroy(vnode) {
                composerWidths.get(vnode.elm as HTMLTextAreaElement)?.disconnect();
              },
            },
            on: {
              input: e => {
                const el = e.target as HTMLTextAreaElement;
                ctrl.updateDraft(el.value);
                fitComposer(el);
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
        ]),
        h(
          'button.msg-app__convo__post__submit',
          {
            attrs: {
              type: 'submit',
              hidden: !ctrl.editing && !ctrl.draft.trim() && !ctrl.attachments?.active,
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
