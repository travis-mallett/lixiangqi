import { el, button, link, request, errorText } from './dom';
import { gameLink } from './gameLink';
import { resetTrialStorage } from './trialReset';
import { type Bootstrap, type Challenge, type Game } from './types';

export async function initModule(options: Bootstrap): Promise<void> {
  const root = document.getElementById('three-kingdoms')!;
  const t = i18n.threeKingdoms;
  const navigation = el('nav', 'three-kingdoms__navigation');
  navigation.append(
    link(t.rated, '/play/room/threeKingdoms-v1-ranked-15+0-m60'),
    link(t.computer, '/?variant=threeKingdoms#ai'),
    link(t.friends, '/?variant=threeKingdoms#friend'),
    link(t.analysis, '/analysis/threeKingdoms'),
    link(t.history, '/three-kingdoms/history'),
    link(t.live, '/three-kingdoms/live'),
    link(t.rules, '/variant/threeKingdoms'),
  );
  root.replaceChildren(el('h1', '', t.title), navigation);
  const content = el('section', 'three-kingdoms__content');
  root.append(content);
  const message = el('p', 'three-kingdoms__status');
  message.setAttribute('role', 'status');
  content.append(message);
  const showError = (error: unknown) => {
    message.textContent = errorText(error);
  };
  try {
    resetTrialStorage();
    switch (options.mode) {
      case 'home':
        content.append(el('p', '', t.rulesIntro), el('p', '', t.timeControl));
        if (options.me) {
          const [ongoing, invitations] = await Promise.all([
            request<{ games: Game[] }>('ongoing'),
            request<{ challenges: Challenge[] }>('challenge'),
          ]);
          for (const game of ongoing.games) content.append(gameLink(game));
          for (const invitation of invitations.challenges)
            content.append(
              link(
                `${t.friends}: ${invitation.users.join(' · ')}`,
                `/three-kingdoms/challenge/${invitation.id}`,
              ),
            );
        }
        break;
      case 'challenge': {
        const id = options.challenge!.id;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const render = (challenge: Challenge) => {
          content.replaceChildren(message);
          if (challenge.status === 'started') {
            stopped = true;
            location.href = `/three-kingdoms/game/${id}`;
            return;
          }
          if (['declined', 'cancelled'].includes(challenge.status) || challenge.expiresAt <= Date.now()) {
            message.textContent = t.challengeUnavailable;
            stopped = true;
            return;
          }
          message.textContent = t.pending;
          for (const user of challenge.users)
            content.append(
              el('p', '', `${user} · ${challenge.accepted.includes(user) ? t.accepted : t.pending}`),
            );
          const answer = async (accept: boolean) => {
            try {
              render(await request<Challenge>(`challenge/${id}/${accept ? 'accept' : 'decline'}`, {}));
            } catch (error) {
              showError(error);
            }
          };
          if (!challenge.accepted.includes(options.me!))
            content.append(button(t.accept, () => void answer(true), 'button'));
          content.append(button(t.decline, () => void answer(false)));
        };
        render(options.challenge!);
        const poll = async () => {
          if (stopped) return;
          try {
            render(await request<Challenge>(`challenge/${id}`));
          } catch (error) {
            showError(error);
          }
          if (!stopped) timer = setTimeout(poll, 2500);
        };
        timer = setTimeout(poll, 2500);
        window.addEventListener(
          'pagehide',
          () => {
            stopped = true;
            clearTimeout(timer);
          },
          { once: true },
        );
        break;
      }
      case 'history':
      case 'live': {
        let before: string | undefined;
        const historyUser = options.user ?? options.me;
        if (options.mode === 'history' && historyUser)
          content.append(
            link(t.export, `/api/three-kingdoms/user/${encodeURIComponent(historyUser)}/export`),
          );
        const list = el('div', 'three-kingdoms__history');
        content.append(list);
        const more = button(t.more, () => void load());
        async function load() {
          more.disabled = true;
          try {
            const user = options.user ?? options.me;
            const query = new URLSearchParams();
            if (user) query.set('user', user);
            if (before) query.set('before', String(before));
            const result = await request<{ games: Game[]; before?: string }>(
              options.mode === 'live' ? 'live' : `history?${query}`,
            );
            for (const game of result.games) list.append(gameLink(game));
            before = result.before;
            more.hidden = options.mode === 'live' || result.games.length < 20;
            if (!list.childElementCount) message.textContent = t.emptyHistory;
          } catch (error) {
            showError(error);
          }
          more.disabled = false;
        }
        if (!options.me && options.mode === 'history' && !options.user) {
          const local = JSON.parse(localStorage.getItem('threeKingdoms.localHistory') ?? '[]') as Game[];
          for (const game of local) list.append(gameLink(game));
        }
        content.append(more);
        await load();
        break;
      }
    }
  } catch (error) {
    showError(error);
    content.append(button(t.retry, () => location.reload()));
  }
}
