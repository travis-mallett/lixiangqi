import { form, json } from 'lib/xhr';

interface Line {
  id: string;
  user: string;
  text: string;
}

export function initGlobalChat() {
  const card = document.querySelector<HTMLElement>('.lobby__global-chat');
  if (!card) return;
  const list = card.querySelector<HTMLElement>('.lobby__global-chat__messages')!;
  const status = card.querySelector<HTMLElement>('[role=status]')!;
  const composer = card.querySelector('form');
  let visible = false,
    version = 0,
    signature = '',
    timer: Timeout | undefined;
  async function refresh() {
    const current = ++version;
    clearTimeout(timer);
    if (!visible || document.hidden) return;
    try {
      const { msgs } = await json<{ msgs: Line[] }>('/inbox/public/global');
      if (version !== current) return;
      const next = JSON.stringify(msgs);
      if (next !== signature) {
        const follow = !signature || list.scrollHeight - list.clientHeight - list.scrollTop < 16;
        signature = next;
        list.replaceChildren(
          ...msgs.reverse().map(m => {
            const row = document.createElement('p'),
              author = document.createElement('a');
            author.href = '/@/' + encodeURIComponent(m.user);
            author.textContent = m.user;
            row.append(author, ' ', m.text);
            return row;
          }),
        );
        if (!msgs.length) list.textContent = card!.dataset.empty!;
        if (follow) list.scrollTop = list.scrollHeight;
      }
    } catch {
      if (current === version && !signature) list.textContent = card!.dataset.error!;
    } finally {
      if (current === version && visible && !document.hidden) timer = setTimeout(refresh, 8000);
    }
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    void refresh();
  }).observe(card);
  document.addEventListener('visibilitychange', refresh);
  if (composer) {
    let retry: { text: string; nonce: string } | undefined;
    composer.addEventListener('submit', async event => {
      event.preventDefault();
      const input = composer.elements.namedItem('text') as HTMLInputElement,
        button = composer.querySelector('button')!;
      const text = input.value.trim();
      if (!text || button.disabled) return;
      button.disabled = true;
      status.textContent = '';
      if (retry?.text !== text) retry = { text, nonce: window.crypto.randomUUID() };
      try {
        await json(composer.action, { method: 'POST', body: form(retry) });
        retry = undefined;
        if (input.value.trim() === text) input.value = '';
        await refresh();
      } catch {
        status.textContent = card.dataset.error!;
      } finally {
        button.disabled = false;
      }
    });
  }
}
