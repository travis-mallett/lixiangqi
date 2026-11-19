import { h, type VNode } from 'snabbdom';

import type { Msg } from '../interfaces';

// The inbox and public preview both receive messages newest first.
export function messageTimeline<T extends Pick<Msg, 'user' | 'date'>>(
  messages: T[],
  render: (message: T, first: boolean, last: boolean) => VNode,
): VNode[] {
  if (!messages.length) return [dayLabel(new Date())];
  const timeline: VNode[] = [];
  let group: T[] = [];
  const finishGroup = () => {
    timeline.push(
      h(
        'group',
        group.map((msg, i) => render(msg, i === 0, i === group.length - 1)),
      ),
    );
    group = [];
  };
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const previous = messages[i + 1];
    const newDay = !previous || !sameDay(msg.date, previous.date);
    if (newDay || previous.user !== msg.user || msg.date.getTime() - previous.date.getTime() >= 300_000) {
      if (group.length) finishGroup();
      if (newDay) timeline.push(dayLabel(msg.date));
    }
    group.push(msg);
  }
  finishGroup();
  return timeline;
}

export const messageTime = (date: Date) =>
  h(
    'time',
    { attrs: { title: date.toLocaleString(), datetime: date.toISOString() } },
    date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  );

function dayLabel(date: Date) {
  const today = new Date();
  if (sameDay(date, today)) return h('day.today', i18n.site.today.toUpperCase());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return h(
    'day',
    sameDay(date, yesterday)
      ? i18n.site.yesterday.toUpperCase()
      : date.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' }),
  );
}

const sameDay = (d: Date, e: Date) =>
  d.getDate() === e.getDate() && d.getMonth() === e.getMonth() && d.getFullYear() === e.getFullYear();
