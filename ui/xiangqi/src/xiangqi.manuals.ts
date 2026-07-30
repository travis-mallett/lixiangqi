import { initMiniBoardWith } from 'lib/view';

import { requestXiangqi } from './api';
import { analysisGameUrl } from './gameCatalog';
import { createMoveTreeFromUciMainline, mainlineEndPath, nodeAtPath } from './tree';

interface AncientManualGame {
  id: string;
  externalId: string;
  title: string;
  order: number;
  sourceUrl: string;
  initialFen: string;
  moves: string[];
}

interface AncientManualChapter {
  title: string;
  order: number;
  sourceUrl: string;
  games: AncientManualGame[];
}

interface AncientManual {
  slug: string;
  title: string;
  nativeTitle: string;
  order: number;
  expectedGames: number;
  gameCount: number;
  sourceUrl: string;
  chapters: AncientManualChapter[];
}

interface AncientManualResult {
  available: boolean;
  totalGames: number;
  manuals: AncientManual[];
}

const BOOK_ASSET = site.asset.url('images/learn/ancient-manual-book.png');

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

function finalFen(game: AncientManualGame): string {
  const tree = createMoveTreeFromUciMainline(game.initialFen, game.moves);
  return nodeAtPath(tree, mainlineEndPath(tree))?.state.fen || game.initialFen;
}

function renderGames(container: HTMLElement, chapter: AncientManualChapter): void {
  if (container.dataset.rendered) return;
  container.dataset.rendered = 'true';

  chapter.games.forEach(game => {
    const link = document.createElement('a');
    link.className = 'ancient-manual-game';
    link.href = analysisGameUrl(game.id);

    const board = document.createElement('span');
    board.className = 'ancient-manual-game__board mini-board cg-wrap is2d';
    board.setAttribute('aria-hidden', 'true');

    const title = textElement('span', game.title, 'ancient-manual-game__title');
    link.append(board, title);
    container.append(link);

    initMiniBoardWith(board, {
      fen: finalFen(game),
      orientation: 'white',
    });
  });
}

function renderChapter(chapter: AncientManualChapter, chinese: boolean): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'ancient-manual-chapter';

  const summary = document.createElement('summary');
  summary.append(
    textElement('span', chapter.title, 'ancient-manual-chapter__title'),
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
    if (details.open) renderGames(games, chapter);
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
    textElement('h2', manual.title),
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
        manual.gameCount,
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
  if (manual.chapters.length) {
    manual.chapters.forEach(chapter => chapters.append(renderChapter(chapter, chinese)));
  } else {
    chapters.append(textElement('p', chinese ? '尚未导入棋局。' : 'No games imported yet.'));
  }

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

function renderLibrary(result: AncientManualResult, chinese: boolean): void {
  const list = document.querySelector<HTMLElement>('#ancient-manuals-list');
  const detail = document.querySelector<HTMLElement>('#ancient-manual-detail');
  const library = list?.closest<HTMLElement>('.ancient-manuals__library');
  if (!list || !detail || !library) return;
  list.replaceChildren();

  result.manuals.forEach(manual => {
    const card = document.createElement('button');
    card.className = 'ancient-manual-card';
    card.type = 'button';
    card.dataset.manualSlug = manual.slug;
    card.setAttribute('aria-expanded', 'false');
    card.setAttribute('aria-controls', 'ancient-manual-detail');

    const cover = document.createElement('span');
    cover.className = 'ancient-manual-card__cover';
    const image = document.createElement('img');
    image.src = BOOK_ASSET;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.loading = 'lazy';
    const inscription = textElement('span', manual.nativeTitle, 'ancient-manual-card__inscription');
    inscription.lang = 'zh';
    inscription.setAttribute('aria-hidden', 'true');
    if (manual.nativeTitle.length > 7) inscription.classList.add('long');
    cover.append(image, inscription);

    const copy = document.createElement('span');
    copy.className = 'ancient-manual-card__copy';
    copy.append(
      textElement('strong', manual.title, 'ancient-manual-card__title'),
      textElement(
        'span',
        `${quantity(manual.gameCount, chinese ? '局' : 'game', chinese ? '局' : 'games')} · ${quantity(
          manual.chapters.length,
          chinese ? '章' : 'chapter',
          chinese ? '章' : 'chapters',
        )}`,
        'ancient-manual-card__meta',
      ),
    );
    card.append(cover, copy);
    card.addEventListener('click', () => renderManualDetail(detail, library, manual, chinese, card));
    list.append(card);
  });
  detail.hidden = true;
  library.hidden = false;
}

export default async function init(
  opts: { explorerEndpoint?: string; language?: string } = {},
): Promise<void> {
  const status = document.querySelector<HTMLElement>('#ancient-manuals-status');
  if (!status) return;
  try {
    const endpoint = (opts.explorerEndpoint || '').replace(/\/$/, '');
    const language = opts.language || 'en';
    const chinese = language.toLowerCase().startsWith('zh');
    const result = await requestXiangqi<AncientManualResult>(`${endpoint}/games/ancient-manuals`, {
      language,
    });
    renderLibrary(result, chinese);
    status.textContent = result.available
      ? chinese
        ? `已导入 ${result.totalGames.toLocaleString()} 局`
        : `${result.totalGames.toLocaleString()} imported games`
      : chinese
        ? '棋谱数据库尚不可用。'
        : 'The games database is not available yet.';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add('error');
  }
}
