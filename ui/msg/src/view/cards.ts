import { h, type VNode } from 'snabbdom';

import { userProfilePath } from 'lib/username';
import { json } from 'lib/xhr';

import type MsgCtrl from '../ctrl';
import type { Msg, MsgCard, User } from '../interfaces';
import { glyph, glyphElement } from './icons';
import { playerName, playerElement } from './identity';
import { dialog, showEmoji } from './messageActions';

export async function composeCard(ctrl: MsgCtrl, type: 'poll' | 'contact') {
  const dest = ctrl.data.convo?.user.id;
  if (!dest) return;
  const t = i18n.inbox;
  const form = document.createElement('form');
  form.className = 'msg-card-form';
  const title = document.createElement('h2');
  title.textContent = type === 'poll' ? t.createPoll : t.shareContact;
  form.append(title);
  const dlg = await dialog(form, 'msg-card-dialog', title.textContent);
  const submit = document.createElement('button');
  submit.className = 'button';
  submit.textContent = t.send;
  const error = document.createElement('p');
  error.role = 'alert';
  let card: () => MsgCard | undefined;
  if (type === 'poll') {
    form.classList.add('msg-poll-form');
    const input = (placeholder: string) => {
      const el = document.createElement('input');
      el.placeholder = placeholder;
      el.setAttribute('aria-label', placeholder);
      el.maxLength = 100;
      return el;
    };
    const question = input(t.pollQuestion);
    question.required = true;
    const options = document.createElement('div');
    const fields: HTMLInputElement[] = [];
    const append = () => {
      const el = input(t.pollOption + ' ' + (fields.length + 1));
      fields.push(el);
      const row = document.createElement('div');
      row.className = 'msg-poll-input';
      const emoji = document.createElement('button');
      emoji.type = 'button';
      emoji.setAttribute('aria-label', t.addEmoji + ' · ' + el.placeholder);
      emoji.append(glyphElement('smiley'));
      emoji.onclick = () => {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        void showEmoji(t.addEmoji, value => {
          if (el.value.length - (end - start) + value.length > el.maxLength) return;
          el.setRangeText(value, start, end, 'end');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.focus();
        });
      };
      el.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          fields[fields.indexOf(el) + 1]?.focus();
        }
      };
      row.append(el, emoji);
      options.append(row);
      el.oninput = () => {
        if (el === fields[fields.length - 1] && el.value.trim() && fields.length < 10) append();
        if (
          !el.value &&
          el === fields[fields.length - 2] &&
          !fields[fields.length - 1]?.value &&
          fields.length > 2
        )
          fields.pop()?.parentElement?.remove();
      };
    };
    append();
    append();
    const label = document.createElement('label');
    const multiple = document.createElement('input');
    multiple.type = 'checkbox';
    multiple.checked = true;
    multiple.setAttribute('role', 'switch');
    label.append(t.allowMultiple, multiple);
    const questionLabel = document.createElement('label');
    question.id = 'msg-poll-question';
    questionLabel.htmlFor = question.id;
    questionLabel.textContent = t.pollQuestion;
    const legend = document.createElement('strong');
    legend.textContent = t.pollOption;
    form.append(questionLabel, question, legend, options, label);
    card = () => {
      const answers = fields.map(el => el.value.trim()).filter(Boolean);
      if (!question.value.trim() || answers.length < 2) return;
      return {
        poll: {
          question: question.value.trim(),
          options: answers,
          multiple: multiple.checked,
          ended: false,
          votes: [],
        },
      };
    };
    question.focus();
  } else {
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = t.searchPeople;
    search.setAttribute('aria-label', t.searchPeople);
    const list = document.createElement('div');
    list.className = 'msg-contact-choices';
    let selected: string | undefined;
    let people = ctrl.data.contacts.map(c => c.user).filter(u => !u.group);
    const refresh = () => {
      list.replaceChildren(
        ...people
          .filter(u => u.name.toLowerCase().includes(search.value.toLowerCase()))
          .map(u => {
            const row = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'contact';
            radio.checked = selected === u.name;
            radio.onchange = () => {
              selected = u.name;
              submit.disabled = false;
            };
            row.append(radio, playerElement(u));
            return row;
          }),
      );
    };
    search.oninput = refresh;
    refresh();
    void json<{ friends: User[] }>('/inbox/contacts/friends')
      .then(data => {
        people = [...new Map([...people, ...data.friends].map(u => [u.name.toLowerCase(), u])).values()];
        refresh();
      })
      .catch(() => {});
    form.append(search, list);
    search.focus();
    card = () => (selected ? { contact: selected } : undefined);
  }
  submit.disabled = true;
  form.oninput = () => {
    submit.disabled = !card();
  };
  if (type === 'poll') {
    const footer = document.createElement('footer');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t.cancel;
    cancel.onclick = () => dlg.close();
    footer.append(cancel, submit);
    form.append(error, footer);
  } else form.append(error, submit);
  form.onsubmit = async e => {
    e.preventDefault();
    const value = card();
    if (!value || dest !== ctrl.data.convo?.user.id) return;
    submit.disabled = true;
    if (await ctrl.sendCard(value, type === 'poll' ? () => dlg.close() : undefined)) {
      if (type === 'contact') dlg.close();
    } else {
      error.textContent = ctrl.submissionError || t.error;
      submit.disabled = false;
    }
  };
}

export function renderCard(ctrl: MsgCtrl | undefined, msg: Msg, pollCounts?: number[]): VNode | undefined {
  const card = msg.card;
  if (!card || msg.deleted) return;
  if (card.contact)
    return h('div.msg-shared-contact', [
      glyph('contact'),
      h('a', { attrs: { href: userProfilePath(card.contact) } }, [playerName(card.contact)]),
      ctrl &&
        h(
          'button',
          { on: { click: () => void ctrl.openConvo(card.contact!.toLowerCase()) } },
          i18n.inbox.message,
        ),
    ]);
  const poll = card.poll;
  if (!poll) return;
  const current = poll.votes.find(v => v.user === ctrl?.data.me.id)?.choices ?? [];
  return h('div.msg-poll', [
    h('strong', poll.question),
    ...poll.options.map((option, i) => {
      const selected = current.includes(i);
      const voters = poll.votes.filter(v => v.choices.includes(i));
      return h(
        'button',
        {
          attrs: {
            type: 'button',
            disabled: !ctrl || poll.ended || !!msg.pending,
            'aria-pressed': String(selected),
          },
          on: {
            click: () => {
              const choices = selected ? current.filter(n => n !== i) : poll.multiple ? [...current, i] : [i];
              void ctrl?.act(msg, 'vote', JSON.stringify(choices));
            },
          },
        },
        [
          !poll.ended ? h('span.msg-poll-choice', selected ? [glyph('check')] : []) : undefined,
          h('span.msg-poll-option', [
            h('span', option),
            h('small', String(pollCounts?.[i] ?? voters.length)),
            h('span.msg-poll-bar', { attrs: { 'aria-hidden': 'true' } }, [
              h('span', { style: { width: (100 * voters.length) / Math.max(1, poll.votes.length) + '%' } }),
            ]),
          ]),
        ],
      );
    }),
    poll.votes.length
      ? h('details', [
          h('summary', i18n.inbox.viewVotes),
          ...poll.options.map((label, i) =>
            h('p', [
              h('strong', label),
              ...poll.votes.filter(v => v.choices.includes(i)).map(v => playerName(v.user)),
            ]),
          ),
        ])
      : undefined,
    poll.ended
      ? h('small', i18n.inbox.pollEnded)
      : ctrl && msg.user === ctrl.data.me.id && !msg.pending
        ? h(
            'button',
            {
              on: {
                click: () => {
                  if (window.confirm(i18n.inbox.endPoll + '?')) void ctrl.act(msg, 'endPoll');
                },
              },
            },
            i18n.inbox.endPoll,
          )
        : undefined,
  ]);
}
