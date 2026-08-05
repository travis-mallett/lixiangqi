import { requestXiangqi } from './api';
import ExplorerCtrl from './explorer/explorerCtrl';
import type { ExplorerColor, ExplorerGame } from './explorer/interfaces';
import {
  analysisGameUrl,
  databaseEventUrl,
  databasePlayerUrl,
  resultLabel,
  sourceLabels,
  type CatalogDirection,
  type CatalogGame,
  type CatalogPlayer,
  type CatalogSort,
  type CatalogSource,
  type CatalogTimelineUnit,
  type PlayerDatabaseResult,
  type PlayerDatabaseSummary,
  type PlayerOutcome,
} from './gameCatalog';
import {
  legalMoveDests,
  makeXiangqiGround,
  setXiangqiGroundPending,
  uciMoveToCg,
  XIANGQI_START_FEN,
  type RulesState,
} from './index';

interface PlayerPageBootstrap {
  explorerEndpoint?: string;
  player?: string;
}

interface MoveResponse extends RulesState {
  notation?: string;
  chineseNotation?: string;
}

interface ExploredPosition {
  state: RulesState;
  move?: string;
  notation?: string;
}

const PAGE_SIZE = 100;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const validSorts = new Set<CatalogSort>([
  'source',
  'date',
  'red',
  'black',
  'result',
  'event',
  'round',
  'moves',
]);

const required = <T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T => {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing player page element: ${selector}`);
  return element;
};

const pageContent = required('#player-database-content');
const pageStatus = required('#player-database-status');
const playerNameElement = required('#player-database-name');
const playerRangeElement = required('#player-database-range');
const sourceInputs = [...document.querySelectorAll<HTMLInputElement>('[data-player-sources]')];
const sourceLabelsElements = [...document.querySelectorAll<HTMLElement>('[data-player-source-count]')];
const timelineUnitInput = required<HTMLSelectElement>('#player-timeline-unit');
const timelineChart = required('#player-timeline-chart');
const timelineSummary = required('#player-timeline-summary');
const timelineEmpty = required('#player-timeline-empty');
const gameRows = required<HTMLTableSectionElement>('#player-games-rows');
const gamesSummary = required('#player-games-summary');
const previousButton = required<HTMLButtonElement>('#player-games-previous');
const nextButton = required<HTMLButtonElement>('#player-games-next');
const pageLabel = required('#player-games-page');
const sortButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-player-sort]')];
const redSideButton = required<HTMLButtonElement>('#player-side-red');
const blackSideButton = required<HTMLButtonElement>('#player-side-black');
const explorerBackButton = required<HTMLButtonElement>('#player-explorer-back');
const explorerResetButton = required<HTMLButtonElement>('#player-explorer-reset');
const explorerMoves = required<HTMLOListElement>('#player-explorer-moves');

let endpoint = '';
let requestedPlayer = '';
let page = 1;
let sort: CatalogSort = 'date';
let direction: CatalogDirection = 'desc';
let timelineUnit: CatalogTimelineUnit = 'year';
let total = 0;
let profileController: AbortController | undefined;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let currentTimeline: PlayerDatabaseResult['timeline'] | undefined;

function selectedSources(): CatalogSource[] {
  return sourceInputs.flatMap(input =>
    input.checked ? (input.dataset.playerSources?.split(',') as CatalogSource[]) : [],
  );
}

function restoreUrlState(): ExplorerColor {
  const params = new URLSearchParams(location.search);
  const selected = params.get('sources')?.split(',');
  if (selected?.length) {
    sourceInputs.forEach(input => {
      const values = input.dataset.playerSources?.split(',') ?? [];
      input.checked = values.some(value => selected.includes(value));
    });
  }
  const requestedSort = params.get('sort') as CatalogSort | null;
  if (requestedSort && validSorts.has(requestedSort)) sort = requestedSort;
  direction = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const requestedTime = params.get('time') as CatalogTimelineUnit | null;
  if (requestedTime && ['month', 'year', 'decade'].includes(requestedTime)) timelineUnit = requestedTime;
  timelineUnitInput.value = timelineUnit;
  const requestedPage = Number(params.get('page'));
  if (Number.isSafeInteger(requestedPage) && requestedPage > 0) page = requestedPage;
  return params.get('side') === 'black' ? 'black' : 'red';
}

function saveUrlState(side?: ExplorerColor): void {
  const url = new URL(location.href);
  const sources = selectedSources();
  if (sources.length === 11) url.searchParams.delete('sources');
  else url.searchParams.set('sources', sources.join(','));
  if (sort === 'date') url.searchParams.delete('sort');
  else url.searchParams.set('sort', sort);
  if (direction === 'desc') url.searchParams.delete('dir');
  else url.searchParams.set('dir', direction);
  if (timelineUnit === 'year') url.searchParams.delete('time');
  else url.searchParams.set('time', timelineUnit);
  if (page === 1) url.searchParams.delete('page');
  else url.searchParams.set('page', String(page));
  if (side === 'black') url.searchParams.set('side', side);
  else if (side === 'red') url.searchParams.delete('side');
  history.replaceState(null, '', url);
}

function percentage(value: number, totalValue: number): number {
  return totalValue ? Math.round((value * 1000) / totalValue) / 10 : 0;
}

function formatPercent(value: number): string {
  return `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

function formatRecordedDate(value?: string): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value || 'unknown';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function renderOutcome(id: 'red' | 'black', outcome: PlayerOutcome): void {
  required(`#player-${id}-games`).textContent = `${outcome.games.toLocaleString()} games`;
  const values: Array<['wins' | 'draws' | 'losses', number]> = [
    ['wins', outcome.wins],
    ['draws', outcome.draws],
    ['losses', outcome.losses],
  ];
  const bar = required(`#player-${id}-bar`);
  values.forEach(([kind, count]) => {
    const percent = percentage(count, outcome.games);
    const segment = required(`.${kind}`, bar);
    segment.style.width = `${percent}%`;
    segment.textContent = percent >= 12 ? formatPercent(percent) : '';
    segment.title = `${formatPercent(percent)} (${count.toLocaleString()} games)`;
    required(`#player-${id}-${kind}`).textContent = formatPercent(percent);
  });
  bar.setAttribute(
    'aria-label',
    `${formatPercent(percentage(outcome.wins, outcome.games))} wins, ${formatPercent(
      percentage(outcome.draws, outcome.games),
    )} draws, ${formatPercent(percentage(outcome.losses, outcome.games))} losses`,
  );
}

function renderMetrics(summary: PlayerDatabaseSummary): void {
  required('#player-metric-games').textContent = summary.totalGames.toLocaleString();
  const points = summary.overall.wins + summary.overall.draws / 2;
  required('#player-metric-score').textContent = formatPercent(percentage(points, summary.overall.games));
  required('#player-metric-opponents').textContent = summary.opponents.toLocaleString();
  required('#player-metric-rating').textContent = summary.averageRating?.toLocaleString() ?? '—';
  required('#player-metric-moves').textContent =
    summary.averageMoves === undefined ? '—' : summary.averageMoves.toLocaleString();
  renderOutcome('red', summary.red);
  renderOutcome('black', summary.black);
}

function rankedRow(name: string, games: number, detail: string, href?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'player-database__ranked-row';
  const identity = href ? document.createElement('a') : document.createElement('span');
  identity.textContent = name;
  if (identity instanceof HTMLAnchorElement && href) identity.href = href;
  const record = document.createElement('span');
  record.textContent = detail;
  const count = document.createElement('strong');
  count.textContent = games.toLocaleString();
  const maximum = document.createElement('i');
  maximum.style.setProperty('--rank-size', String(games));
  row.append(maximum, identity, record, count);
  return row;
}

function renderInsights(summary: PlayerDatabaseSummary): void {
  const opponents = required('#player-opponents');
  opponents.replaceChildren(
    ...summary.topOpponents.map(opponent =>
      rankedRow(
        opponent.name,
        opponent.games,
        `${opponent.wins}–${opponent.draws}–${opponent.losses}`,
        databasePlayerUrl(opponent.romanizedName || opponent.nativeName || opponent.name),
      ),
    ),
  );
  if (!summary.topOpponents.length) opponents.textContent = 'No opponent names are available.';

  const openings = required('#player-openings');
  openings.replaceChildren(
    ...summary.topOpenings.map(opening =>
      rankedRow(opening.name, opening.games, `${percentage(opening.games, summary.totalGames)}%`),
    ),
  );
  if (!summary.topOpenings.length) openings.textContent = 'No opening classifications are available.';

  for (const list of [opponents, openings]) {
    const counts = [...list.querySelectorAll<HTMLElement>('.player-database__ranked-row strong')].map(
      element => Number(element.textContent?.replaceAll(',', '') || 0),
    );
    const maximum = Math.max(1, ...counts);
    list.querySelectorAll<HTMLElement>('.player-database__ranked-row i').forEach((bar, index) => {
      bar.style.width = `${(counts[index] / maximum) * 100}%`;
    });
  }
}

function renderEmptySummary(): void {
  const emptyOutcome: PlayerOutcome = { games: 0, wins: 0, draws: 0, losses: 0 };
  renderMetrics({
    totalGames: 0,
    opponents: 0,
    events: 0,
    overall: emptyOutcome,
    red: emptyOutcome,
    black: emptyOutcome,
    topOpponents: [],
    topOpenings: [],
  });
  renderInsights({
    totalGames: 0,
    opponents: 0,
    events: 0,
    overall: emptyOutcome,
    red: emptyOutcome,
    black: emptyOutcome,
    topOpponents: [],
    topOpenings: [],
  });
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

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, String(value)));
  return element;
}

function niceMaximum(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function renderTimeline(timeline: PlayerDatabaseResult['timeline']): void {
  currentTimeline = timeline;
  const points = timeline.buckets
    .map(bucket => ({ ...bucket, ordinal: timelineOrdinal(bucket.start, timeline.unit) }))
    .filter(point => Number.isFinite(point.ordinal) && point.count > 0);
  timelineEmpty.hidden = points.length > 0;
  timelineChart.hidden = points.length === 0;
  if (!points.length) {
    timelineChart.replaceChildren();
    timelineSummary.textContent = timeline.undated
      ? `${timeline.undated.toLocaleString()} games do not have a precise date.`
      : 'No dated games are available for these sources.';
    return;
  }

  const first = points[0].ordinal;
  const last = points[points.length - 1].ordinal;
  const span = Math.max(1, last - first + 1);
  const minimumStep = timeline.unit === 'month' ? 7 : timeline.unit === 'year' ? 16 : 40;
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
  const maximum = niceMaximum(Math.max(...points.map(point => point.count)));
  const barWidth = Math.max(3, Math.min(32, step * 0.72));
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, width, height });
  svg.classList.add('player-database__timeline-svg');
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  [maximum, maximum / 2, 0].forEach(value => {
    const y = top + plotHeight - (value / maximum) * plotHeight;
    const line = svgElement('line', { x1: left, x2: width - right, y1: y, y2: y });
    line.classList.add('grid');
    const label = svgElement('text', { x: left - 9, y: y + 4, 'text-anchor': 'end' });
    label.textContent = compact.format(value);
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
      rx: 2,
    });
    const title = svgElement('title');
    title.textContent = `${timelineLabel(point.ordinal, timeline.unit)}: ${point.count.toLocaleString()} games`;
    bar.append(title);
    svg.append(bar);
  });
  const targetTicks = Math.max(2, Math.min(9, Math.floor(plotWidth / 90)));
  const tickStep = Math.max(1, Math.ceil((span - 1) / (targetTicks - 1)));
  const ticks = new Set<number>();
  for (let ordinal = first; ordinal <= last; ordinal += tickStep) ticks.add(ordinal);
  ticks.add(last);
  ticks.forEach(ordinal => {
    const x = span === 1 ? left + plotWidth / 2 : left + (ordinal - first) * step;
    const label = svgElement('text', {
      x,
      y: height - 10,
      'text-anchor': ordinal === first ? 'start' : ordinal === last ? 'end' : 'middle',
    });
    label.textContent = timelineLabel(ordinal, timeline.unit);
    svg.append(label);
  });
  timelineChart.replaceChildren(svg);
  timelineChart.scrollLeft = timelineChart.scrollWidth;
  const dated = points.reduce((sum, point) => sum + point.count, 0);
  const undated = timeline.undated ? ` · ${timeline.undated.toLocaleString()} without a precise date` : '';
  timelineSummary.textContent = `${dated.toLocaleString()} dated games · ${timelineLabel(
    first,
    timeline.unit,
  )}–${timelineLabel(last, timeline.unit)}${undated}`;
}

function playerSearchTerm(player: CatalogPlayer): string {
  return player.romanizedName || player.nativeName || player.name;
}

function playerCell(game: CatalogGame, color: 'red' | 'black'): HTMLTableCellElement {
  const player = game[color];
  const cell = document.createElement('td');
  if (game.playerColor === color) cell.classList.add('player-database__selected-player');
  const link = document.createElement('a');
  link.className = 'games-database__player';
  link.textContent = player.name || 'Unknown';
  link.href = databasePlayerUrl(playerSearchTerm(player));
  cell.append(link);
  if (player.rating) {
    const rating = document.createElement('small');
    rating.textContent = String(player.rating);
    cell.append(rating);
  }
  return cell;
}

function textCell(value?: string, className?: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value || '—';
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
  cell.append(link);
  return cell;
}

function sourceCell(game: CatalogGame): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'games-database__sources';
  game.sources.forEach(source => {
    const badge = document.createElement('span');
    badge.textContent = sourceLabels[source.id] ?? source.name;
    cell.append(badge);
  });
  return cell;
}

function renderGames(games: CatalogGame[]): void {
  if (!games.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.className = 'games-database__empty';
    cell.textContent = 'No games are available for the selected sources.';
    row.append(cell);
    gameRows.replaceChildren(row);
    return;
  }
  gameRows.replaceChildren(
    ...games.map(game => {
      const row = document.createElement('tr');
      row.tabIndex = 0;
      row.setAttribute('aria-label', `Open ${game.red.name} versus ${game.black.name} in Analysis`);
      row.append(
        sourceCell(game),
        textCell(game.playedAt ?? (game.year ? String(game.year) : undefined)),
        playerCell(game, 'red'),
        playerCell(game, 'black'),
        textCell(resultLabel(game.result), 'games-database__result'),
        eventCell(game.event),
        textCell(game.round, 'games-database__optional'),
        textCell(String(game.moves), 'games-database__optional games-database__moves'),
      );
      row.addEventListener('click', event => {
        if (!(event.target instanceof HTMLAnchorElement)) location.assign(analysisGameUrl(game.id));
      });
      row.addEventListener('keydown', event => {
        if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          location.assign(analysisGameUrl(game.id));
        }
      });
      return row;
    }),
  );
}

function renderSort(): void {
  sortButtons.forEach(button => {
    const active = button.dataset.playerSort === sort;
    button.classList.toggle('active', active);
    button.dataset.direction = active ? direction : '';
    button.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

function renderSourceCounts(result: PlayerDatabaseResult): void {
  sourceLabelsElements.forEach(label => {
    const source = label.dataset.playerSourceCount as keyof PlayerDatabaseResult['sourceCounts'];
    const count = result.sourceCounts[source];
    const base = label.dataset.playerSourceLabel ?? label.textContent ?? '';
    const clean = base.replace(/\s+\([\d,]+\)$/, '');
    label.textContent = `${clean} (${(count ?? 0).toLocaleString()})`;
  });
}

function renderProfile(result: PlayerDatabaseResult): void {
  if (!result.available) throw new Error(result.error || 'The games database is unavailable.');
  if (!result.player) throw new Error(`No database player matches “${requestedPlayer}”.`);
  playerNameElement.textContent = result.player.name;
  document.title = `${result.player.name} — Games Database`;
  renderSourceCounts(result);
  renderTimeline(result.timeline);
  renderGames(result.games);
  renderSort();
  total = result.total;
  const first = total ? (page - 1) * result.pageSize + 1 : 0;
  const last = Math.min(page * result.pageSize, total);
  gamesSummary.textContent = total
    ? `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} games`
    : 'No games match the selected sources.';
  pageLabel.textContent = `Page ${page} of ${Math.max(1, Math.ceil(total / result.pageSize))}`;
  previousButton.disabled = page <= 1;
  nextButton.disabled = page * result.pageSize >= total;

  if (result.summary) {
    renderMetrics(result.summary);
    renderInsights(result.summary);
    const firstDate = formatRecordedDate(result.summary.firstPlayedAt);
    const lastDate = formatRecordedDate(result.summary.lastPlayedAt);
    const eventLabel = result.summary.events === 1 ? 'event' : 'events';
    playerRangeElement.textContent = `${result.summary.totalGames.toLocaleString()} recorded games · ${firstDate}–${lastDate} · ${result.summary.events.toLocaleString()} ${eventLabel}`;
  } else {
    renderEmptySummary();
    playerRangeElement.textContent = 'No games match the selected sources.';
  }
  pageStatus.textContent = 'Player statistics loaded';
  pageStatus.classList.remove('error');
  pageContent.hidden = false;
}

async function loadProfile(): Promise<void> {
  profileController?.abort();
  const controller = new AbortController();
  profileController = controller;
  saveUrlState();
  pageStatus.textContent = 'Updating player statistics…';
  pageStatus.classList.remove('error');
  gameRows.setAttribute('aria-busy', 'true');
  try {
    const result = await requestXiangqi<PlayerDatabaseResult>(
      `${endpoint.replace(/\/$/, '')}/games/player`,
      {
        player: requestedPlayer,
        sources: selectedSources(),
        timelineUnit,
        sort,
        direction,
        page,
        pageSize: PAGE_SIZE,
      },
      controller.signal,
    );
    if (result.total && page > Math.ceil(result.total / result.pageSize)) {
      page = Math.ceil(result.total / result.pageSize);
      await loadProfile();
      return;
    }
    renderProfile(result);
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
    pageStatus.textContent = error instanceof Error ? error.message : String(error);
    pageStatus.classList.add('error');
  } finally {
    if (!controller.signal.aborted) gameRows.removeAttribute('aria-busy');
  }
}

function loadExplorerGame(game: ExplorerGame): void {
  location.assign(analysisGameUrl(game.id));
}

async function initializeExplorer(initialSide: ExplorerColor): Promise<void> {
  const initialState = await requestXiangqi<RulesState>('/api/analysis/position', {
    initialFen: XIANGQI_START_FEN,
    moves: [],
  });
  const positions: ExploredPosition[] = [{ state: initialState }];
  let pending = false;
  const boardElement = required('#player-xiangqi-board');
  const turnColor = (state: RulesState) => (state.turn === 'red' ? 'white' : 'black');
  const ground = makeXiangqiGround(boardElement, {
    fen: initialState.fen,
    orientation: initialSide === 'black' ? 'black' : 'white',
    turnColor: turnColor(initialState),
    movableColor: turnColor(initialState),
    legalMoves: initialState.legalMoves,
    onMove: move => void play(move),
  });
  const explorer = new ExplorerCtrl(
    required('#player-opening-explorer'),
    required<HTMLButtonElement>('#player-opening-explorer-toggle'),
    move => void play(move),
    loadExplorerGame,
    endpoint,
    {
      lockedPlayer: requestedPlayer,
      initialColor: initialSide,
      initiallyEnabled: true,
      configurationEnabled: false,
    },
  );

  const current = () => positions[positions.length - 1].state;

  function update(syncPosition = true, slide = false): void {
    const position = positions[positions.length - 1];
    if (syncPosition)
      ground.set(
        {
          fen: position.state.fen,
          turnColor: turnColor(position.state),
          lastMove: position.move ? uciMoveToCg(position.move) : undefined,
          movable: {
            free: false,
            color: pending || position.state.gameResult !== '*' ? undefined : turnColor(position.state),
            dests: pending ? new Map() : legalMoveDests(position.state.legalMoves),
          },
        },
        slide ? { animation: 'slide' } : undefined,
      );
    explorer.setPosition({ fen: position.state.fen });
    explorerBackButton.disabled = positions.length === 1 || pending;
    explorerResetButton.disabled = positions.length === 1 || pending;
    explorerMoves.replaceChildren(
      ...positions.slice(1).map((entry, index) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = entry.notation || entry.move || '';
        button.title = `Return to position after ${button.textContent}`;
        button.addEventListener('click', () => {
          if (pending) return;
          positions.splice(index + 2);
          update(true, true);
        });
        item.append(button);
        return item;
      }),
    );
  }

  async function play(move: string): Promise<void> {
    if (pending) return;
    pending = true;
    setXiangqiGroundPending(ground);
    update(false);
    try {
      const response = await requestXiangqi<MoveResponse>('/api/analysis/move', {
        initialFen: current().fen,
        moves: [],
        move,
      });
      positions.push({ state: response, move, notation: response.notation || move });
    } catch (error) {
      ground.set({ fen: current().fen });
      pageStatus.textContent = error instanceof Error ? error.message : String(error);
      pageStatus.classList.add('error');
    } finally {
      pending = false;
      update();
    }
  }

  function selectSide(side: ExplorerColor): void {
    explorer.selectColor(side);
    if (
      (side === 'black' && ground.state.orientation !== 'black') ||
      (side === 'red' && ground.state.orientation !== 'white')
    )
      ground.toggleOrientation();
    redSideButton.classList.toggle('active', side === 'red');
    blackSideButton.classList.toggle('active', side === 'black');
    redSideButton.setAttribute('aria-pressed', String(side === 'red'));
    blackSideButton.setAttribute('aria-pressed', String(side === 'black'));
    const actor = side === 'red' ? 'Red' : 'Black';
    required('#player-repertoire-explanation').textContent =
      `Showing games where this player was ${actor}. On the player’s turns, the rows are their choices; on the opponent’s turns, the rows show the lines that led to those replies.`;
    saveUrlState(side);
  }

  redSideButton.addEventListener('click', () => selectSide('red'));
  blackSideButton.addEventListener('click', () => selectSide('black'));
  explorerBackButton.addEventListener('click', () => {
    if (pending || positions.length === 1) return;
    positions.pop();
    update(true, true);
  });
  explorerResetButton.addEventListener('click', () => {
    if (pending || positions.length === 1) return;
    positions.splice(1);
    update(true, true);
  });
  selectSide(initialSide);
  update();
  Object.assign(window, { lixiangqiPlayerGround: ground });
}

export default function init(bootstrap: PlayerPageBootstrap = {}): void {
  endpoint = bootstrap.explorerEndpoint || '';
  requestedPlayer = bootstrap.player?.trim() || '';
  if (!requestedPlayer) {
    pageStatus.textContent = 'No database player was selected.';
    pageStatus.classList.add('error');
    return;
  }
  const initialSide = restoreUrlState();
  sourceInputs.forEach(input =>
    input.addEventListener('change', () => {
      page = 1;
      void loadProfile();
    }),
  );
  timelineUnitInput.addEventListener('change', () => {
    timelineUnit = timelineUnitInput.value as CatalogTimelineUnit;
    void loadProfile();
  });
  sortButtons.forEach(button =>
    button.addEventListener('click', () => {
      const selected = button.dataset.playerSort as CatalogSort;
      direction =
        sort === selected ? (direction === 'asc' ? 'desc' : 'asc') : selected === 'date' ? 'desc' : 'asc';
      sort = selected;
      page = 1;
      void loadProfile();
    }),
  );
  previousButton.addEventListener('click', () => {
    if (page <= 1) return;
    page -= 1;
    void loadProfile();
  });
  nextButton.addEventListener('click', () => {
    if (page * PAGE_SIZE >= total) return;
    page += 1;
    void loadProfile();
  });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentTimeline) renderTimeline(currentTimeline);
    }, 120);
  });
  void loadProfile();
  void initializeExplorer(initialSide).catch(error => {
    pageStatus.textContent = error instanceof Error ? error.message : String(error);
    pageStatus.classList.add('error');
  });
}

if (!('site' in window)) init();
