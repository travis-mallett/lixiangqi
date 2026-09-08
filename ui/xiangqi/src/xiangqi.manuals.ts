import { initMiniBoardWith } from 'lib/view';

import {
  ancientManuals,
  type AncientManual,
  type AncientManualChapter,
  type LocalizedText,
} from './ancientManuals';
import { analysisGameUrl } from './gameCatalog';

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function quantity(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function localized(text: LocalizedText, chinese: boolean): string {
  return chinese ? text.zh : text.en;
}

function renderGames(container: HTMLElement, chapter: AncientManualChapter, chinese: boolean): void {
  if (container.dataset.rendered) return;
  container.dataset.rendered = 'true';

  chapter.games.forEach(game => {
    const link = document.createElement('a');
    link.className = 'ancient-manual-game';
    link.href = analysisGameUrl(game.id);

    const board = document.createElement('span');
    board.className = 'ancient-manual-game__board mini-board cg-wrap is2d';
    board.setAttribute('aria-hidden', 'true');

    const title = textElement('span', localized(game.title, chinese), 'ancient-manual-game__title');
    link.append(board, title);
    container.append(link);

    initMiniBoardWith(board, {
      fen: game.finalFen,
      orientation: 'white',
    });
  });
}

function renderChapter(chapter: AncientManualChapter, chinese: boolean): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'ancient-manual-chapter';

  const summary = document.createElement('summary');
  summary.append(
    textElement('span', localized(chapter.title, chinese), 'ancient-manual-chapter__title'),
    textElement(
      'span',
      quantity(chapter.games.length, chinese ? '局' : 'game', chinese ? '局' : 'games'),
      'ancient-manual-chapter__count',
    ),
  );

  const games = document.createElement('div');
  games.className = 'ancient-manual-games';
  details.append(summary, games);
  details.addEventListener('toggle', () => {
    if (details.open) renderGames(games, chapter, chinese);
  });
  return details;
}

function animateView(element: HTMLElement, className: string): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  element.classList.remove('view-enter', 'view-return');
  void element.offsetWidth;
  element.classList.add(className);
  element.addEventListener('animationend', () => element.classList.remove(className), { once: true });
}

function showLibrary(library: HTMLElement, detail: HTMLElement, selectedCard: HTMLButtonElement): void {
  detail.hidden = true;
  library.hidden = false;
  document.querySelectorAll<HTMLButtonElement>('.ancient-manual-card').forEach(card => {
    card.classList.remove('active');
    card.setAttribute('aria-expanded', 'false');
  });
  animateView(library, 'view-return');
  library.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
  selectedCard.focus({ preventScroll: true });
}

function renderManualDetail(
  detail: HTMLElement,
  library: HTMLElement,
  manual: AncientManual,
  chinese: boolean,
  selectedCard: HTMLButtonElement,
): void {
  document.querySelectorAll<HTMLButtonElement>('.ancient-manual-card').forEach(card => {
    const selected = card === selectedCard;
    card.classList.toggle('active', selected);
    card.setAttribute('aria-expanded', String(selected));
  });

  const heading = document.createElement('div');
  heading.className = 'ancient-manual-detail__heading';
  const titleGroup = document.createElement('div');
  titleGroup.append(
    textElement('p', chinese ? '所选古谱' : 'Selected manual', 'ancient-manual-detail__eyebrow'),
    textElement('h2', localized(manual.title, chinese)),
    textElement(
      'p',
      chinese
        ? '展开章节以查看各局终局图与棋局名称。'
        : 'Expand a chapter to browse its games by final position.',
    ),
  );
  heading.append(
    titleGroup,
    textElement(
      'span',
      `${quantity(manual.chapters.length, chinese ? '章' : 'chapter', chinese ? '章' : 'chapters')} · ${quantity(
        manual.chapters.reduce((count, chapter) => count + chapter.games.length, 0),
        chinese ? '局' : 'game',
        chinese ? '局' : 'games',
      )}`,
      'ancient-manual-detail__count',
    ),
  );

  const back = document.createElement('button');
  back.className = 'ancient-manual-detail__back';
  back.type = 'button';
  back.textContent = chinese ? '← 返回典籍目录' : '← Back to collection';
  back.addEventListener('click', () => showLibrary(library, detail, selectedCard));

  const chapters = document.createElement('div');
  chapters.className = 'ancient-manual-chapters';
  manual.chapters.forEach(chapter => chapters.append(renderChapter(chapter, chinese)));

  detail.replaceChildren(back, heading, chapters);
  detail.hidden = false;
  library.hidden = true;
  animateView(detail, 'view-enter');
  detail.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
  back.focus({ preventScroll: true });
}

function bindLibrary(chinese: boolean): void {
  const list = document.querySelector<HTMLElement>('#ancient-manuals-list');
  const detail = document.querySelector<HTMLElement>('#ancient-manual-detail');
  const library = list?.closest<HTMLElement>('.ancient-manuals__library');
  if (!list || !detail || !library) return;

  const manualsBySlug = new Map(ancientManuals.map(manual => [manual.slug, manual]));
  list.querySelectorAll<HTMLButtonElement>('.ancient-manual-card').forEach(card => {
    const manual = manualsBySlug.get(card.dataset.manualSlug!)!;
    card.addEventListener('click', () => renderManualDetail(detail, library, manual, chinese, card));
  });
}

export default function init(opts: { language: string }): void {
  bindLibrary(opts.language.toLowerCase().startsWith('zh'));
}
