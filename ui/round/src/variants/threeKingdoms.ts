import {
  loadRules,
  request,
  el,
  link,
  errorText,
  type Bootstrap,
  type Color,
  type Game,
} from 'threeKingdoms';

import { Round, localGame } from './threeKingdomsCtrl';

export async function initThreeKingdoms(options: Bootstrap): Promise<{ destroy(): void }> {
  const content = document.querySelector<HTMLElement>('.round__app')!;
  const t = i18n.threeKingdoms;
  const message = el('p', 'round__status');
  message.setAttribute('role', 'status');
  content.append(message);
  const showError = (error: unknown) => {
    message.textContent = errorText(error);
  };
  await site.asset.loadPieces;
  try {
    switch (options.mode) {
      case 'local': {
        const rules = await loadRules();
        const setup = sessionStorage.getItem('threeKingdoms.localSetup');
        const saved = localStorage.getItem('threeKingdoms.localGame');
        let game: Game;
        if (setup) {
          const config = JSON.parse(setup);
          if (
            ![420, 600, 900].includes(config.initialSeconds) ||
            ![15, 30, 60].includes(config.moveSeconds) ||
            !['red', 'green', 'black'].includes(config.color) ||
            !Number.isInteger(config.level) ||
            config.level < 1 ||
            config.level > 5
          )
            throw new Error('invalidRequest');
          game = localGame(
            rules,
            config.color as Color,
            config.level,
            config.initialSeconds,
            config.moveSeconds,
          );
          sessionStorage.removeItem('threeKingdoms.localSetup');
        } else if (saved) game = JSON.parse(saved) as Game;
        else {
          location.href = '/?variant=threeKingdoms#ai';
          return { destroy() {} };
        }
        if (game.source === 'local-completion') {
          const current = await request<Game>(`game/${game.id}?history=true`);
          return new Round(content, current, rules, options);
        }
        return new Round(content, game, rules, options, true);
      }
      case 'tv': {
        let round: Round | undefined;
        let currentId: string | undefined;
        const watching = { ...options, me: null };
        const rules = await loadRules();
        const show = (game: Game) => {
          if (game.id === currentId) return;
          round?.destroy();
          currentId = game.id;
          const host = document.createElement('div');
          host.className = 'round__app';
          const previous = document.querySelector('.round__app')!;
          previous.replaceWith(host);
          round = new Round(host, game, rules, watching);
        };
        const source = new EventSource('/api/three-kingdoms/tv/stream');
        let selection = 0;
        let closed = false;
        source.onmessage = async event => {
          const game = JSON.parse(event.data) as Game;
          if (game.id && game.id !== currentId) {
            const version = ++selection;
            try {
              const full = await request<Game>(`game/${game.id}?history=true`);
              if (!closed && version === selection) show(full);
            } catch (error) {
              if (!closed) showError(error);
            }
          }
        };
        window.addEventListener(
          'pagehide',
          () => {
            closed = true;
            source.close();
            round?.destroy();
          },
          { once: true },
        );
        const { game, history } = await request<{ game?: Game; history: Game[] }>('tv');
        if (!closed && !selection && game) show(game);
        else if (!game && !currentId) message.textContent = i18n.site.noGameFound;
        if (!closed && history.length) {
          const recent = el('section', 'three-kingdoms__history');
          recent.append(
            el('h2', '', i18n.site.previouslyOnLichessTV),
            ...history.map(g =>
              link(
                g.seats.map(s => s.user?.name ?? (s.guest ? i18n.site.anonymous : t.computer)).join(' · '),
                `/three-kingdoms/game/${g.id}`,
              ),
            ),
          );
          document.querySelector('.round__underboard')!.append(recent);
        }
        return {
          destroy() {
            closed = true;
            source.close();
            round?.destroy();
          },
        };
      }
      case 'game':
        return new Round(content, options.game!, await loadRules(), options);
      default:
        throw new Error('invalidRequest');
    }
  } catch (error) {
    showError(error);
  }
  return { destroy() {} };
}
