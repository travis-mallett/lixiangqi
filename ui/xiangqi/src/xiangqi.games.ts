import { requestXiangqi } from './api';
import {
  analysisGameUrl,
  catalogSources,
  countedSourceLabel,
  isCatalogSource,
  resultLabel,
  sourceLabels,
  type CatalogDirection,
  type CatalogCountSource,
  type CatalogGame,
  type CatalogResult,
  type CatalogSort,
  type CatalogSource,
} from './gameCatalog';

const PAGE_SIZE = 100;
const sourceGroups: Record<string, readonly CatalogSource[]> = {
  online: ['n', 't', 'k', 'o', 'b', 'u', 'w'],
};
const validSorts: ReadonlySet<CatalogSort> = new Set([
  'source',
  'date',
  'red',
  'black',
  'result',
  'event',
  'round',
  'moves',
]);

const form = document.querySelector<HTMLFormElement>('#games-database-search')!;
const queryInput = document.querySelector<HTMLInputElement>('#games-database-query')!;
const status = document.querySelector<HTMLElement>('#games-database-status')!;
const rows = document.querySelector<HTMLTableSectionElement>('#games-database-rows')!;
const previous = document.querySelector<HTMLButtonElement>('#games-database-previous')!;
const next = document.querySelector<HTMLButtonElement>('#games-database-next')!;
const pageLabel = document.querySelector<HTMLElement>('#games-database-page')!;
const sourceParents = [...document.querySelectorAll<HTMLInputElement>('[data-source-parent]')];
const sourceInputs = [...document.querySelectorAll<HTMLInputElement>('[data-source]')];
const sortButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-sort]')];
const sourceCountLabels = [...document.querySelectorAll<HTMLElement>('[data-source-count]')];

let page = 1;
let sort: CatalogSort = 'date';
let direction: CatalogDirection = 'desc';
let total = 0;
let controller: AbortController | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let explorerEndpoint = '';

function selectedSources(): CatalogSource[] {
  return sourceInputs
    .filter(input => input.checked && isCatalogSource(input.dataset.source ?? ''))
    .map(input => input.dataset.source as CatalogSource);
}

function syncParents(): void {
  sourceParents.forEach(parent => {
    const group = sourceGroups[parent.dataset.sourceParent ?? ''] ?? [];
    const children = sourceInputs.filter(input => group.includes(input.dataset.source as CatalogSource));
    const checked = children.filter(input => input.checked).length;
    parent.checked = checked === children.length;
    parent.indeterminate = checked > 0 && checked < children.length;
  });
}

function renderSourceCounts(counts: Record<CatalogCountSource, number>): void {
  sourceCountLabels.forEach(label => {
    const source = label.dataset.sourceCount as CatalogCountSource;
    const count = counts[source];
    if (Number.isSafeInteger(count) && count >= 0) {
      label.textContent = countedSourceLabel(label.dataset.sourceLabel ?? '', count);
    }
  });
}

function restoreUrlState(): void {
  const params = new URLSearchParams(location.search);
  const requestedSources = params.get('sources')?.split(',').filter(isCatalogSource);
  if (requestedSources?.length) {
    sourceInputs.forEach(
      input => (input.checked = requestedSources.includes(input.dataset.source as CatalogSource)),
    );
  }
  queryInput.value = params.get('q')?.slice(0, 100) ?? '';
  const requestedSort = params.get('sort');
  if (requestedSort && validSorts.has(requestedSort as CatalogSort)) sort = requestedSort as CatalogSort;
  direction = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const requestedPage = Number(params.get('page'));
  if (Number.isSafeInteger(requestedPage) && requestedPage > 0) page = requestedPage;
  syncParents();
}

function saveUrlState(): void {
  const url = new URL(location.href);
  const sources = selectedSources();
  if (sources.length === catalogSources.length) url.searchParams.delete('sources');
  else url.searchParams.set('sources', sources.join(','));
  const query = queryInput.value.trim();
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  if (sort === 'date') url.searchParams.delete('sort');
  else url.searchParams.set('sort', sort);
  if (direction === 'desc') url.searchParams.delete('dir');
  else url.searchParams.set('dir', direction);
  if (page === 1) url.searchParams.delete('page');
  else url.searchParams.set('page', String(page));
  history.replaceState(null, '', url);
}

function textCell(value?: string, className?: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value || '—';
  return cell;
}

function playerCell(game: CatalogGame, color: 'red' | 'black'): HTMLTableCellElement {
  const player = game[color];
  const cell = document.createElement('td');
  const name = document.createElement('a');
  name.className = 'games-database__player';
  name.textContent = player.name || 'Unknown';
  name.href = analysisGameUrl(game.id);
  cell.append(name);
  if (player.rating) {
    const rating = document.createElement('small');
    rating.textContent = String(player.rating);
    cell.append(rating);
  }
  return cell;
}

function renderSourceCell(game: CatalogGame): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'games-database__sources';
  game.sources.forEach(source => {
    const badge = document.createElement('span');
    badge.textContent = sourceLabels[source.id] ?? source.name;
    cell.append(badge);
  });
  return cell;
}

function openGame(game: CatalogGame): void {
  location.assign(analysisGameUrl(game.id));
}

function renderGames(games: CatalogGame[]): void {
  if (!games.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.className = 'games-database__empty';
    cell.textContent = 'No games match these filters.';
    row.append(cell);
    rows.replaceChildren(row);
    return;
  }
  rows.replaceChildren(
    ...games.map(game => {
      const row = document.createElement('tr');
      row.tabIndex = 0;
      row.dataset.gameId = game.id;
      row.setAttribute('aria-label', `Open ${game.red.name} versus ${game.black.name} in Analysis`);
      row.append(
        renderSourceCell(game),
        textCell(game.playedAt ?? (game.year ? String(game.year) : undefined)),
        playerCell(game, 'red'),
        playerCell(game, 'black'),
        textCell(resultLabel(game.result), 'games-database__result'),
        textCell(game.event),
        textCell(game.round, 'games-database__optional'),
        textCell(String(game.moves), 'games-database__optional games-database__moves'),
      );
      row.addEventListener('click', event => {
        if (!(event.target instanceof HTMLAnchorElement)) openGame(game);
      });
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openGame(game);
        }
      });
      return row;
    }),
  );
}

function renderSort(): void {
  sortButtons.forEach(button => {
    const active = button.dataset.sort === sort;
    button.classList.toggle('active', active);
    button.dataset.direction = active ? direction : '';
    button.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

async function loadGames(): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  saveUrlState();
  renderSort();
  const sources = selectedSources();
  if (!sources.length) {
    total = 0;
    renderGames([]);
    status.textContent = 'Select at least one source.';
    pageLabel.textContent = 'Page 1';
    previous.disabled = next.disabled = true;
    return;
  }
  status.textContent = 'Loading games…';
  status.classList.remove('error');
  rows.setAttribute('aria-busy', 'true');
  previous.disabled = next.disabled = true;
  try {
    const result = await requestXiangqi<CatalogResult>(
      `${explorerEndpoint.replace(/\/$/, '')}/games`,
      { sources, search: queryInput.value.trim(), sort, direction, page, pageSize: PAGE_SIZE },
      controller.signal,
    );
    total = result.total;
    renderSourceCounts(result.sourceCounts);
    if (total && page > Math.ceil(total / result.pageSize)) {
      page = Math.ceil(total / result.pageSize);
      await loadGames();
      return;
    }
    renderGames(result.games);
    const first = total ? (page - 1) * result.pageSize + 1 : 0;
    const last = Math.min(page * result.pageSize, total);
    status.textContent = result.available
      ? `Showing ${first}–${last} of ${total.toLocaleString()} games`
      : 'The games database is not available yet.';
    pageLabel.textContent = `Page ${page} of ${Math.max(1, Math.ceil(total / result.pageSize))}`;
    previous.disabled = page <= 1;
    next.disabled = page * result.pageSize >= total;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    total = 0;
    renderGames([]);
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add('error');
  } finally {
    rows.removeAttribute('aria-busy');
  }
}

export default function init(opts: { explorerEndpoint?: string } = {}): void {
  explorerEndpoint = opts.explorerEndpoint || '';
  form.addEventListener('submit', event => {
    event.preventDefault();
    page = 1;
    void loadGames();
  });
  queryInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 1;
      void loadGames();
    }, 350);
  });
  sourceInputs.forEach(input =>
    input.addEventListener('change', () => {
      syncParents();
      page = 1;
      void loadGames();
    }),
  );
  sourceParents.forEach(parent =>
    parent.addEventListener('change', () => {
      const group = sourceGroups[parent.dataset.sourceParent ?? ''] ?? [];
      sourceInputs.forEach(input => {
        if (group.includes(input.dataset.source as CatalogSource)) input.checked = parent.checked;
      });
      syncParents();
      page = 1;
      void loadGames();
    }),
  );
  sortButtons.forEach(button =>
    button.addEventListener('click', () => {
      const selected = button.dataset.sort as CatalogSort;
      direction =
        sort === selected ? (direction === 'asc' ? 'desc' : 'asc') : selected === 'date' ? 'desc' : 'asc';
      sort = selected;
      page = 1;
      void loadGames();
    }),
  );
  previous.addEventListener('click', () => {
    if (page <= 1) return;
    page--;
    void loadGames();
  });
  next.addEventListener('click', () => {
    if (page * PAGE_SIZE >= total) return;
    page++;
    void loadGames();
  });

  restoreUrlState();
  void loadGames();
}

if (!('site' in window)) init();
