import { requestXiangqi } from './api';
import {
  analysisGameUrl,
  catalogSources,
  countedSourceLabel,
  databaseEventUrl,
  databasePlayerUrl,
  isCatalogSource,
  resultLabel,
  sortSourceKeysByCount,
  sourceLabels,
  type CatalogDirection,
  type CatalogCountSource,
  type CatalogGame,
  type CatalogPlayer,
  type CatalogResult,
  type CatalogSort,
  type CatalogSource,
  type CatalogTimelineUnit,
} from './gameCatalog';

const PAGE_SIZE = 100;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
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
const sourceFilters = document.querySelector<HTMLElement>('.games-database__filters')!;
const totalUniqueGames = document.querySelector<HTMLElement>('#games-database-total-unique')!;
const weeklyCount = document.querySelector<HTMLElement>('#games-database-weekly-count')!;
const weeklyLabel = document.querySelector<HTMLElement>('#games-database-weekly-label')!;
const timelineUnitInput = document.querySelector<HTMLSelectElement>('#games-database-time-unit')!;
const timelineChart = document.querySelector<HTMLElement>('#games-database-timeline-chart')!;
const timelineSummary = document.querySelector<HTMLElement>('#games-database-timeline-summary')!;
const timelineEmpty = document.querySelector<HTMLElement>('#games-database-timeline-empty')!;

let page = 1;
let sort: CatalogSort = 'date';
let direction: CatalogDirection = 'desc';
let timelineUnit: CatalogTimelineUnit = 'year';
let total = 0;
let controller: AbortController | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let explorerEndpoint = '';
let nativeWeeklyAdded = 0;
let currentTimeline: CatalogResult['timeline'] | undefined;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;

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
  sortSourceFilters(counts);
}

function sortSourceFilters(counts: Record<CatalogCountSource, number>): void {
  const onlineParent = sourceParents.find(parent => parent.dataset.sourceParent === 'online');
  const onlineLabel = onlineParent?.closest<HTMLLabelElement>('label');
  const onlineChildren = onlineLabel?.nextElementSibling;
  const topLevelItems: Array<{ key: CatalogCountSource; nodes: HTMLElement[] }> = sourceInputs
    .filter(input => !input.closest('.games-database__source-children'))
    .map(input => ({
      key: input.dataset.source as CatalogCountSource,
      nodes: [input.closest<HTMLLabelElement>('label')!],
    }));
  if (onlineLabel && onlineChildren) {
    topLevelItems.push({ key: 'online', nodes: [onlineLabel, onlineChildren as HTMLElement] });
  }

  const itemsByKey = new Map(topLevelItems.map(item => [item.key, item]));
  sortSourceKeysByCount(
    topLevelItems.map(item => item.key),
    counts,
  ).forEach(key => itemsByKey.get(key)?.nodes.forEach(node => sourceFilters.append(node)));

  if (onlineChildren) {
    const children = [
      ...onlineChildren.querySelectorAll<HTMLLabelElement>(':scope > label[data-source-item]'),
    ];
    const childrenByKey = new Map(
      children.map(child => [child.dataset.sourceItem as CatalogCountSource, child]),
    );
    sortSourceKeysByCount([...childrenByKey.keys()], counts).forEach(key => {
      const child = childrenByKey.get(key);
      if (child) onlineChildren.append(child);
    });
  }
}

function renderTotalUniqueGames(count: number): void {
  if (Number.isSafeInteger(count) && count >= 0) {
    totalUniqueGames.textContent = count.toLocaleString('en-US');
  }
}

function renderWeeklyAdded(catalogWeeklyAdded = 0): void {
  const count = nativeWeeklyAdded + Math.max(0, catalogWeeklyAdded);
  weeklyCount.textContent = count.toLocaleString('en-US');
  weeklyLabel.textContent = count === 1 ? 'new game added this week!' : 'new games added this week!';
}

function timelineOrdinal(start: string, unit: CatalogTimelineUnit): number {
  if (unit === 'month') {
    const [year, month] = start.split('-').map(Number);
    return Number.isInteger(year) && month >= 1 && month <= 12 ? year * 12 + month - 1 : Number.NaN;
  }
  const year = Number(start);
  return Number.isInteger(year) ? (unit === 'decade' ? Math.floor(year / 10) : year) : Number.NaN;
}

function timelineLabel(ordinal: number, unit: CatalogTimelineUnit): string {
  if (unit === 'month') {
    const year = Math.floor(ordinal / 12);
    const month = ordinal % 12;
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year, month, 1)),
    );
  }
  return unit === 'decade' ? `${ordinal * 10}s` : String(ordinal);
}

function niceMaximum(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, String(value)));
  return element;
}

function renderTimeline(timeline: CatalogResult['timeline']): void {
  currentTimeline = timeline;
  const points = timeline.buckets
    .map(bucket => ({ ...bucket, ordinal: timelineOrdinal(bucket.start, timeline.unit) }))
    .filter(point => Number.isFinite(point.ordinal) && Number.isSafeInteger(point.count) && point.count > 0);
  const dated = points.reduce((sum, point) => sum + point.count, 0);
  timelineEmpty.hidden = points.length > 0;
  timelineChart.hidden = points.length === 0;

  if (!points.length) {
    timelineChart.replaceChildren();
    timelineSummary.textContent = timeline.undated
      ? `${timeline.undated.toLocaleString('en-US')} matching games do not have a precise date.`
      : 'No dated games match the current filters.';
    return;
  }

  const first = points[0].ordinal;
  const last = points[points.length - 1].ordinal;
  const span = Math.max(1, last - first + 1);
  const minimumStep = timeline.unit === 'month' ? 7 : timeline.unit === 'year' ? 14 : 34;
  const left = 58;
  const right = 18;
  const top = 14;
  const bottom = 36;
  const height = 230;
  const plotHeight = height - top - bottom;
  const availableWidth = Math.max(timelineChart.clientWidth || 720, 480);
  const width = Math.min(12_000, Math.max(availableWidth, left + right + span * minimumStep));
  const plotWidth = width - left - right;
  const step = span === 1 ? plotWidth : plotWidth / (span - 1);
  const barWidth = Math.max(2, Math.min(30, step * 0.72));
  const maximum = niceMaximum(Math.max(...points.map(point => point.count)));
  const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const exactNumber = new Intl.NumberFormat('en-US');

  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    'aria-hidden': 'true',
  });
  svg.classList.add('games-database__timeline-svg');

  [maximum, maximum / 2, 0].forEach(value => {
    const y = top + plotHeight - (value / maximum) * plotHeight;
    const line = svgElement('line', { x1: left, x2: width - right, y1: y, y2: y });
    line.classList.add('games-database__timeline-grid');
    const label = svgElement('text', { x: left - 9, y: y + 4, 'text-anchor': 'end' });
    label.classList.add('games-database__timeline-axis');
    label.textContent = compactNumber.format(value);
    svg.append(line, label);
  });

  points.forEach(point => {
    const x = span === 1 ? left + plotWidth / 2 : left + (point.ordinal - first) * step;
    const barHeight = Math.max(2, (point.count / maximum) * plotHeight);
    const bar = svgElement('rect', {
      x: x - barWidth / 2,
      y: top + plotHeight - barHeight,
      width: barWidth,
      height: barHeight,
      rx: Math.min(2, barWidth / 3),
    });
    bar.classList.add('games-database__timeline-bar');
    const title = svgElement('title');
    title.textContent = `${timelineLabel(point.ordinal, timeline.unit)}: ${exactNumber.format(point.count)} games`;
    bar.append(title);
    svg.append(bar);
  });

  const targetTicks = Math.max(2, Math.min(9, Math.floor(plotWidth / 90)));
  const tickStep = Math.max(1, Math.ceil((span - 1) / (targetTicks - 1)));
  const tickOrdinals = new Set<number>();
  for (let ordinal = first; ordinal <= last; ordinal += tickStep) tickOrdinals.add(ordinal);
  tickOrdinals.add(last);
  tickOrdinals.forEach(ordinal => {
    const x = span === 1 ? left + plotWidth / 2 : left + (ordinal - first) * step;
    const tick = svgElement('line', {
      x1: x,
      x2: x,
      y1: top + plotHeight,
      y2: top + plotHeight + 5,
    });
    tick.classList.add('games-database__timeline-tick');
    const label = svgElement('text', {
      x,
      y: height - 10,
      'text-anchor': ordinal === first ? 'start' : ordinal === last ? 'end' : 'middle',
    });
    label.classList.add('games-database__timeline-axis');
    label.textContent = timelineLabel(ordinal, timeline.unit);
    svg.append(tick, label);
  });

  timelineChart.replaceChildren(svg);
  timelineChart.scrollLeft = timelineChart.scrollWidth;
  const range =
    first === last
      ? timelineLabel(first, timeline.unit)
      : `${timelineLabel(first, timeline.unit)}–${timelineLabel(last, timeline.unit)}`;
  const undated = timeline.undated
    ? ` · ${timeline.undated.toLocaleString('en-US')} without a precise date`
    : '';
  timelineSummary.textContent = `${dated.toLocaleString('en-US')} dated games · ${range}${undated}`;
  timelineChart.setAttribute(
    'aria-label',
    `${dated.toLocaleString('en-US')} matching dated games from ${timelineLabel(
      first,
      timeline.unit,
    )} to ${timelineLabel(last, timeline.unit)}`,
  );
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
  const requestedTimelineUnit = params.get('time');
  if (requestedTimelineUnit && ['month', 'year', 'decade'].includes(requestedTimelineUnit)) {
    timelineUnit = requestedTimelineUnit as CatalogTimelineUnit;
  }
  timelineUnitInput.value = timelineUnit;
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
  if (timelineUnit === 'year') url.searchParams.delete('time');
  else url.searchParams.set('time', timelineUnit);
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

function playerSearchTerm(player: CatalogPlayer): string {
  return player.romanizedName || player.nativeName || player.name;
}

function playerCell(game: CatalogGame, color: 'red' | 'black'): HTMLTableCellElement {
  const player = game[color];
  const cell = document.createElement('td');
  const name = document.createElement('a');
  const search = playerSearchTerm(player);
  name.className = 'games-database__player';
  name.textContent = player.name || 'Unknown';
  name.href = databasePlayerUrl(search);
  name.title = `Open ${search}'s player page`;
  name.setAttribute('aria-label', `Open database player page for ${search}`);
  cell.append(name);
  if (player.rating) {
    const rating = document.createElement('small');
    rating.textContent = String(player.rating);
    cell.append(rating);
  }
  return cell;
}

function eventCell(event?: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  if (!event) {
    cell.textContent = '—';
    return cell;
  }
  const link = document.createElement('a');
  link.className = 'games-database__event';
  link.textContent = event;
  link.href = databaseEventUrl(event);
  link.title = `Open statistics for ${event}`;
  cell.append(link);
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
        eventCell(game.event),
        textCell(game.round, 'games-database__optional'),
        textCell(String(game.moves), 'games-database__optional games-database__moves'),
      );
      row.addEventListener('click', event => {
        if (!(event.target instanceof HTMLAnchorElement)) openGame(game);
      });
      row.addEventListener('keydown', event => {
        if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
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
    renderTimeline({ unit: timelineUnit, buckets: [], undated: 0 });
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
      {
        sources,
        search: queryInput.value.trim(),
        sort,
        direction,
        page,
        pageSize: PAGE_SIZE,
        timelineUnit,
      },
      controller.signal,
    );
    total = result.total;
    renderTotalUniqueGames(result.totalUniqueGames);
    renderSourceCounts(result.sourceCounts);
    renderTimeline(result.timeline ?? { unit: timelineUnit, buckets: [], undated: 0 });
    renderWeeklyAdded(result.weeklyAdded?.count ?? 0);
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
    renderTimeline({ unit: timelineUnit, buckets: [], undated: 0 });
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add('error');
  } finally {
    rows.removeAttribute('aria-busy');
  }
}

export default function init(opts: { explorerEndpoint?: string; nativeWeeklyAdded?: number } = {}): void {
  explorerEndpoint = opts.explorerEndpoint || '';
  nativeWeeklyAdded =
    Number.isSafeInteger(opts.nativeWeeklyAdded) && (opts.nativeWeeklyAdded ?? 0) >= 0
      ? (opts.nativeWeeklyAdded ?? 0)
      : 0;
  renderWeeklyAdded();
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
  timelineUnitInput.addEventListener('change', () => {
    timelineUnit = timelineUnitInput.value as CatalogTimelineUnit;
    void loadGames();
  });
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
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentTimeline) renderTimeline(currentTimeline);
    }, 120);
  });

  restoreUrlState();
  void loadGames();
}

if (!('site' in window)) init();
