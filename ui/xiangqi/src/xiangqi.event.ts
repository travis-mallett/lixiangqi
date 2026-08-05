import { requestXiangqi } from './api';
import ExplorerCtrl from './explorer/explorerCtrl';
import type { ExplorerGame } from './explorer/interfaces';
import {
  analysisGameUrl,
  catalogSources,
  databasePlayerUrl,
  type CatalogGame,
  type CatalogPlayer,
  type CatalogSource,
  type EventDatabaseResult,
  type EventDatabaseSummary,
} from './gameCatalog';
import {
  legalMoveDests,
  makeXiangqiGround,
  setXiangqiGroundPending,
  uciMoveToCg,
  XIANGQI_START_FEN,
  type RulesState,
} from './index';

interface EventPageBootstrap {
  explorerEndpoint?: string;
  event?: string;
}

interface MoveResponse extends RulesState {
  notation?: string;
}

interface ExploredPosition {
  state: RulesState;
  move?: string;
  notation?: string;
}

const required = <T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T => {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing event page element: ${selector}`);
  return element;
};

const pageContent = required('#event-database-content');
const pageStatus = required('#event-database-status');
const eventNameElement = required('#event-database-name');
const eventRangeElement = required('#event-database-range');
const standingsRows = required<HTMLTableSectionElement>('#event-standings-rows');
const openingsList = required('#event-openings');
const placesList = required('#event-places');
const roundList = required('#event-round-list');
const roundsSummary = required('#event-rounds-summary');
const sourceInputs = [...document.querySelectorAll<HTMLInputElement>('[data-event-sources]')];
const sourceLabelsElements = [...document.querySelectorAll<HTMLElement>('[data-event-source-count]')];
const explorerBackButton = required<HTMLButtonElement>('#event-explorer-back');
const explorerResetButton = required<HTMLButtonElement>('#event-explorer-reset');
const explorerMoves = required<HTMLOListElement>('#event-explorer-moves');

let endpoint = '';
let requestedEvent = '';
let controller: AbortController | undefined;

function selectedSources(): CatalogSource[] {
  return sourceInputs.flatMap(input =>
    input.checked
      ? (input.dataset.eventSources
          ?.split(',')
          .filter(source => catalogSources.includes(source as CatalogSource)) as CatalogSource[])
      : [],
  );
}

function restoreUrlState(): void {
  const selected = new URLSearchParams(location.search).get('sources')?.split(',');
  if (!selected?.length) return;
  sourceInputs.forEach(input => {
    const values = input.dataset.eventSources?.split(',') ?? [];
    input.checked = values.some(value => selected.includes(value));
  });
}

function saveUrlState(): void {
  const url = new URL(location.href);
  const sources = selectedSources();
  if (sources.length === catalogSources.length) url.searchParams.delete('sources');
  else url.searchParams.set('sources', sources.join(','));
  history.replaceState(null, '', url);
}

function formatRecordedDate(value?: string): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value || 'unknown date';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function playerSearchTerm(player: CatalogPlayer): string {
  return player.romanizedName || player.nativeName || player.name;
}

function playerLink(player: CatalogPlayer): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'games-database__player';
  link.textContent = player.name || 'Unknown';
  link.href = databasePlayerUrl(playerSearchTerm(player));
  return link;
}

function renderMetrics(summary: EventDatabaseSummary): void {
  required('#event-metric-games').textContent = summary.totalGames.toLocaleString();
  required('#event-metric-players').textContent = summary.players.toLocaleString();
  required('#event-metric-rounds').textContent = summary.rounds.toLocaleString();
  required('#event-metric-moves').textContent =
    summary.averageMoves === undefined
      ? '—'
      : summary.averageMoves.toLocaleString(undefined, { maximumFractionDigits: 1 });
  required('#event-metric-openings').textContent = summary.recordedOpenings.toLocaleString();
}

function renderStandings(summary: EventDatabaseSummary): void {
  if (!summary.standings.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'games-database__empty';
    cell.textContent = 'No standings can be calculated for the selected sources.';
    row.append(cell);
    standingsRows.replaceChildren(row);
    return;
  }
  standingsRows.replaceChildren(
    ...summary.standings.map(standing => {
      const row = document.createElement('tr');
      const rank = document.createElement('td');
      rank.className = 'event-database__rank';
      rank.textContent = String(standing.rank);
      const player = document.createElement('td');
      player.append(playerLink(standing));
      if (standing.averageRating) {
        const rating = document.createElement('small');
        rating.textContent = `avg ${standing.averageRating}`;
        player.append(rating);
      }
      const values = [standing.games, standing.wins, standing.draws, standing.losses, standing.score].map(
        value => {
          const cell = document.createElement('td');
          cell.textContent = value.toLocaleString();
          return cell;
        },
      );
      values[values.length - 1].classList.add('event-database__score');
      row.append(rank, player, ...values);
      return row;
    }),
  );
}

function rankedRow(name: string, games: number, total: number): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'player-database__ranked-row';
  const bar = document.createElement('i');
  bar.style.width = `${total ? (games / total) * 100 : 0}%`;
  const label = document.createElement('span');
  label.textContent = name;
  const count = document.createElement('strong');
  count.textContent = games.toLocaleString();
  const share = document.createElement('span');
  share.textContent = total ? `${Math.round((games * 1000) / total) / 10}%` : '0%';
  row.append(bar, label, share, count);
  return row;
}

function renderInsights(summary: EventDatabaseSummary): void {
  const total = summary.totalGames;
  const outcomes: Array<[string, number, string]> = [
    ['red', summary.redWins, 'Red wins'],
    ['draws', summary.draws, 'Draws'],
    ['black', summary.blackWins, 'Black wins'],
  ];
  const bar = required('#event-results-bar');
  const legend = required('#event-results-legend');
  legend.replaceChildren();
  outcomes.forEach(([kind, count, label]) => {
    const percent = total ? Math.round((count * 1000) / total) / 10 : 0;
    const segment = required(`.${kind}`, bar);
    segment.style.width = `${percent}%`;
    segment.textContent = percent >= 13 ? `${percent}%` : '';
    segment.title = `${label}: ${count.toLocaleString()} (${percent}%)`;
    const item = document.createElement('span');
    item.className = kind;
    item.textContent = `${label} ${count.toLocaleString()}`;
    legend.append(item);
  });
  bar.setAttribute(
    'aria-label',
    outcomes.map(([, count, label]) => `${label} ${count.toLocaleString()}`).join(', '),
  );

  openingsList.replaceChildren(
    ...summary.topOpenings.map(opening => rankedRow(opening.name, opening.games, total)),
  );
  if (!summary.topOpenings.length) openingsList.textContent = 'No opening classifications are available.';

  placesList.replaceChildren(
    ...summary.places.map(place => {
      const item = document.createElement('span');
      item.textContent = `${place.name} · ${place.games.toLocaleString()} ${place.games === 1 ? 'game' : 'games'}`;
      return item;
    }),
  );
  if (!summary.places.length) placesList.textContent = 'No venue information is available.';
}

function eventResultLabel(result: number): string {
  if (result > 0) return '2–0';
  if (result < 0) return '0–2';
  return '1–1';
}

function roundTitle(name: string): string {
  if (!name) return 'Unspecified round';
  if (/^round\b/i.test(name) || !/^\d/.test(name)) return name;
  return `Round ${name}`;
}

function roundDate(dates: string[]): string {
  const labels = [...new Set(dates.map(formatRecordedDate))];
  if (!labels.length) return 'Date not recorded';
  if (labels.length === 1) return labels[0];
  return `${labels[0]} – ${labels[labels.length - 1]}`;
}

function roundPlayerCell(game: CatalogGame, color: 'red' | 'black'): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.append(playerLink(game[color]));
  if (game[color].rating) {
    const rating = document.createElement('small');
    rating.textContent = String(game[color].rating);
    cell.append(rating);
  }
  return cell;
}

function renderRounds(result: EventDatabaseResult): void {
  const gameCount = result.rounds.reduce((total, round) => total + round.games.length, 0);
  roundsSummary.textContent = result.rounds.length
    ? `${result.rounds.length.toLocaleString()} recorded rounds · ${gameCount.toLocaleString()} games`
    : 'No round labels or games match the selected sources.';
  roundList.replaceChildren(
    ...result.rounds.map(round => {
      const card = document.createElement('article');
      card.className = 'event-database__round';
      const header = document.createElement('header');
      const heading = document.createElement('h3');
      heading.textContent = roundTitle(round.name);
      const date = document.createElement('p');
      date.textContent = roundDate(round.dates);
      header.append(heading, date);
      const tableWrap = document.createElement('div');
      tableWrap.className = 'games-database__table-wrap';
      const table = document.createElement('table');
      table.className = 'slist event-database__round-table';
      const thead = document.createElement('thead');
      const headingRow = document.createElement('tr');
      for (const label of ['Red', 'Outcome', 'Black', 'Game']) {
        const cell = document.createElement('th');
        cell.textContent = label;
        headingRow.append(cell);
      }
      thead.append(headingRow);
      const tbody = document.createElement('tbody');
      round.games.forEach(game => {
        const row = document.createElement('tr');
        const outcome = document.createElement('td');
        outcome.className = 'event-database__round-result';
        outcome.textContent = eventResultLabel(game.result);
        const action = document.createElement('td');
        const link = document.createElement('a');
        link.className = 'event-database__game-link';
        link.href = analysisGameUrl(game.id);
        link.textContent = 'Analysis ↗';
        link.setAttribute('aria-label', `Open ${game.red.name} versus ${game.black.name} in Analysis`);
        action.append(link);
        row.append(roundPlayerCell(game, 'red'), outcome, roundPlayerCell(game, 'black'), action);
        tbody.append(row);
      });
      table.append(thead, tbody);
      tableWrap.append(table);
      card.append(header, tableWrap);
      return card;
    }),
  );
}

function renderSourceCounts(result: EventDatabaseResult): void {
  sourceLabelsElements.forEach(label => {
    const source = label.dataset.eventSourceCount as keyof EventDatabaseResult['sourceCounts'];
    const count = result.sourceCounts[source] ?? 0;
    const base = label.dataset.eventSourceLabel ?? '';
    label.textContent = `${base} (${count.toLocaleString()})`;
  });
}

function renderEvent(result: EventDatabaseResult): void {
  if (!result.available) throw new Error(result.error || 'The games database is unavailable.');
  if (!result.event) throw new Error(`No database event matches “${requestedEvent}”.`);
  eventNameElement.textContent = result.event.name;
  document.title = `${result.event.name} — Games Database`;
  renderSourceCounts(result);
  if (result.summary) {
    renderMetrics(result.summary);
    renderStandings(result.summary);
    renderInsights(result.summary);
    renderRounds(result);
    const first = formatRecordedDate(result.summary.firstPlayedAt);
    const last = formatRecordedDate(result.summary.lastPlayedAt);
    const dateRange = first === last ? first : `${first}–${last}`;
    eventRangeElement.textContent =
      `${result.summary.totalGames.toLocaleString()} recorded games · ${dateRange} · ` +
      `${result.summary.players.toLocaleString()} players`;
  } else {
    const emptySummary: EventDatabaseSummary = {
      totalGames: 0,
      players: 0,
      rounds: 0,
      recordedOpenings: 0,
      redWins: 0,
      draws: 0,
      blackWins: 0,
      standings: [],
      topOpenings: [],
      places: [],
    };
    renderMetrics(emptySummary);
    renderStandings(emptySummary);
    renderInsights(emptySummary);
    renderRounds(result);
    eventRangeElement.textContent = 'No games match the selected sources.';
  }
  pageStatus.textContent = 'Event statistics loaded';
  pageStatus.classList.remove('error');
  pageContent.hidden = false;
}

async function loadEvent(): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  saveUrlState();
  pageStatus.textContent = 'Updating event statistics…';
  pageStatus.classList.remove('error');
  try {
    const result = await requestXiangqi<EventDatabaseResult>(
      `${endpoint.replace(/\/$/, '')}/games/event`,
      {
        event: requestedEvent,
        sources: selectedSources(),
      },
      signal,
    );
    renderEvent(result);
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
    pageStatus.textContent = error instanceof Error ? error.message : String(error);
    pageStatus.classList.add('error');
  }
}

async function initializeExplorer(): Promise<void> {
  const initialState = await requestXiangqi<RulesState>('/api/analysis/position', {
    initialFen: XIANGQI_START_FEN,
    moves: [],
  });
  const positions: ExploredPosition[] = [{ state: initialState }];
  let pending = false;
  const turnColor = (state: RulesState) => (state.turn === 'red' ? 'white' : 'black');
  const ground = makeXiangqiGround(required('#event-xiangqi-board'), {
    fen: initialState.fen,
    orientation: 'white',
    turnColor: turnColor(initialState),
    movableColor: turnColor(initialState),
    legalMoves: initialState.legalMoves,
    onMove: move => void play(move),
  });
  const explorer = new ExplorerCtrl(
    required('#event-opening-explorer'),
    required<HTMLButtonElement>('#event-opening-explorer-toggle'),
    move => void play(move),
    (game: ExplorerGame) => location.assign(analysisGameUrl(game.id)),
    endpoint,
    {
      lockedEvent: requestedEvent,
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
  update();
  Object.assign(window, { lixiangqiEventGround: ground });
}

export default function init(bootstrap: EventPageBootstrap = {}): void {
  endpoint = bootstrap.explorerEndpoint || '';
  requestedEvent = bootstrap.event?.trim() || '';
  if (!requestedEvent) {
    pageStatus.textContent = 'No database event was selected.';
    pageStatus.classList.add('error');
    return;
  }
  restoreUrlState();
  sourceInputs.forEach(input => input.addEventListener('change', () => void loadEvent()));
  void loadEvent();
  void initializeExplorer().catch(error => {
    pageStatus.textContent = error instanceof Error ? error.message : String(error);
    pageStatus.classList.add('error');
  });
}

if (!('site' in window)) init();
