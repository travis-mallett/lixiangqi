import type ExplorerCtrl from './explorerCtrl';
import type { ExplorerData, ExplorerDb, ExplorerGame, ExplorerMove } from './interfaces';

const BOOK_ICON = '\ue03b';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

const button = (text: string, action: () => void, className = 'button-link') => {
  const node = element('button', className);
  node.type = 'button';
  node.textContent = text;
  node.addEventListener('click', action);
  return node;
};

export function render(ctrl: ExplorerCtrl): void {
  const root = ctrl.element;
  root.classList.toggle('loading', ctrl.loading);
  root.classList.toggle('explorer__config', ctrl.configOpen);
  const overlay = element('div', 'overlay');
  root.replaceChildren(overlay, ctrl.configOpen ? configView(ctrl) : dataView(ctrl));
  const settings = button('', () => ctrl.toggleConfig(), 'fbt toconf');
  settings.setAttribute('aria-label', ctrl.configOpen ? 'Close configuration' : 'Open configuration');
  settings.dataset.icon = ctrl.configOpen ? '\ue02a' : '\ue005';
  root.append(settings);
}

function titleView(ctrl: ExplorerCtrl): HTMLDivElement {
  const title = element('div', 'explorer-title');
  const entries: [ExplorerDb, string][] = [
    ['masters', 'Masters'],
    ['lixiangqi', 'Lixiangqi'],
    ['player', 'Player'],
  ];
  for (const [db, name] of entries) {
    if (ctrl.config.db === db) {
      const active = element('span', `active text ${db}`);
      active.dataset.icon = BOOK_ICON;
      const strong = element('strong');
      strong.textContent = db === 'player' && ctrl.config.player ? ctrl.config.player : name;
      active.append(strong, document.createTextNode(db === 'player' ? playerSuffix(ctrl) : ' database'));
      if (db === 'player' && ctrl.config.player) {
        active.classList.add('player');
        active.title = 'Switch sides';
        active.addEventListener('click', () => ctrl.toggleColor());
      }
      title.append(active);
    } else {
      title.append(button(name, () => ctrl.selectDb(db)));
    }
  }
  return title;
}

function playerSuffix(ctrl: ExplorerCtrl): string {
  if (!ctrl.config.player) return ' database';
  return ctrl.config.color === 'red' ? ' as Red' : ' as Black';
}

function dataView(ctrl: ExplorerCtrl): HTMLDivElement {
  const wrapper = element('div', 'data');
  wrapper.append(titleView(ctrl));
  const data = ctrl.data;
  if (ctrl.loading && !data) return wrapper;
  if (!data?.available) {
    const empty = element('div', 'message');
    const heading = element('strong');
    heading.textContent = data?.error || 'No game found';
    const explanation = element('p', 'explanation');
    explanation.textContent =
      ctrl.config.db === 'masters'
        ? 'The DPXQ master-game export has not been installed.'
        : ctrl.config.db === 'player' && !ctrl.config.player
          ? 'Choose a Lixiangqi player in the preferences menu.'
          : 'No game found for these filters.';
    empty.append(heading, explanation);
    wrapper.append(empty);
    return wrapper;
  }
  if (!data.moves.length) {
    const empty = element('div', 'message');
    const heading = element('strong');
    heading.textContent = 'No game found';
    const explanation = element('p', 'explanation');
    explanation.textContent = 'Try including more games from the preferences menu.';
    empty.append(heading, explanation);
    wrapper.append(empty);
    return wrapper;
  }
  wrapper.append(moveTable(ctrl, data));
  if (data.topGames.length) wrapper.append(gameTable(ctrl, 'Top games', data.topGames));
  if (data.recentGames.length) wrapper.append(gameTable(ctrl, 'Recent games', data.recentGames));
  return wrapper;
}

function moveTable(ctrl: ExplorerCtrl, data: ExplorerData): HTMLTableElement {
  const table = element('table', 'moves');
  const head = element('thead');
  const header = element('tr');
  for (const name of ['Move', 'Games', 'Red / Draw / Black']) {
    const cell = element('th');
    cell.textContent = name;
    header.append(cell);
  }
  head.append(header);
  const body = element('tbody');
  const total = data.red + data.draws + data.black;
  for (const move of data.moves) body.append(moveRow(ctrl, move, total));
  body.append(sumRow(data, total));
  table.append(head, body);
  return table;
}

function moveRow(ctrl: ExplorerCtrl, move: ExplorerMove, total: number): HTMLTableRowElement {
  const row = element('tr');
  row.dataset.uci = move.move;
  row.title = `Play ${move.notation} (${move.move})`;
  row.addEventListener('click', () => ctrl.play(move.move));
  const notation = element('td');
  notation.textContent = move.notation;
  const percent = element('td');
  percent.textContent = total ? `${Math.round((move.games * 100) / total)}%` : '0%';
  percent.title = move.games.toLocaleString();
  const outcomes = element('td');
  outcomes.append(outcomeBar(move.red, move.draws, move.black));
  row.append(notation, percent, outcomes);
  return row;
}

function sumRow(data: ExplorerData, total: number): HTMLTableRowElement {
  const row = element('tr', 'sum');
  const sigma = element('td');
  sigma.textContent = 'Σ';
  const games = element('td');
  games.textContent = total.toLocaleString();
  const outcomes = element('td');
  outcomes.append(outcomeBar(data.red, data.draws, data.black));
  row.append(sigma, games, outcomes);
  return row;
}

function outcomeBar(red: number, draws: number, black: number): HTMLDivElement {
  const bar = element('div', 'bar');
  const total = red + draws + black;
  const values: [number, string][] = [
    [red, 'red'],
    [draws, 'draws'],
    [black, 'black'],
  ];
  for (const [value, className] of values) {
    const span = element('span', className);
    const percent = total ? Math.round((value * 100) / total) : 0;
    span.style.width = `${percent}%`;
    span.textContent = percent >= 12 ? `${percent}%` : '';
    span.title = `${percent}% (${value.toLocaleString()})`;
    bar.append(span);
  }
  return bar;
}

function gameTable(ctrl: ExplorerCtrl, title: string, games: ExplorerGame[]): HTMLTableElement {
  const table = element('table', 'games');
  table.dataset.gameList = title === 'Top games' ? 'top' : 'recent';
  const head = element('thead');
  const header = element('tr');
  const cell = element('th', 'title');
  cell.colSpan = 4;
  cell.textContent = title;
  header.append(cell);
  head.append(header);
  const body = element('tbody');
  for (const game of games) {
    const row = element('tr');
    row.tabIndex = 0;
    row.dataset.gameId = game.id;
    row.title = `Open ${game.red.name} – ${game.black.name} in a new analysis tab`;
    const load = () => ctrl.loadGame(game);
    row.addEventListener('click', load);
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      load();
    });
    const ratings = element('td');
    for (const player of [game.red, game.black]) {
      const rating = element('span');
      rating.textContent = player.rating?.toString() || '';
      ratings.append(rating);
    }
    const players = element('td');
    for (const player of [game.red, game.black]) {
      const name = element('span');
      name.textContent = player.name;
      players.append(name);
    }
    const result = element('td');
    result.textContent = game.winner === 'red' ? '1-0' : game.winner === 'black' ? '0-1' : '½-½';
    const year = element('td');
    year.textContent = game.month || game.year?.toString() || '';
    row.append(ratings, players, result, year);
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function configView(ctrl: ExplorerCtrl): HTMLDivElement {
  const wrapper = element('div', 'config');
  wrapper.append(titleView(ctrl));
  if (ctrl.config.db === 'player') {
    const player = element('section', 'name');
    const label = element('label');
    label.textContent = 'Player';
    const line = element('div');
    const input = element('input');
    input.type = 'text';
    input.maxLength = 100;
    input.placeholder = 'Lixiangqi username';
    input.value = ctrl.config.player;
    const select = button('Select', () => ctrl.setPlayer(input.value), 'button');
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') ctrl.setPlayer(input.value);
    });
    line.append(input, select);
    player.append(
      label,
      line,
      choice('Color', ['red', 'black'], ctrl.config.color, value => ctrl.setColor(value)),
    );
    wrapper.append(player);
  }
  const dates = element('section', 'date');
  const label = element('label');
  label.textContent = 'Date';
  dates.append(
    label,
    monthInput('Since', ctrl.config.since, value => ctrl.setDate('since', value)),
    monthInput('Until', ctrl.config.until, value => ctrl.setDate('until', value)),
  );
  wrapper.append(dates);
  const save = element('section', 'save');
  save.append(button('Use these preferences', () => ctrl.applyConfig(), 'button'));
  wrapper.append(save);
  return wrapper;
}

function choice<T extends string>(
  labelText: string,
  values: T[],
  selected: T,
  update: (value: T) => void,
): HTMLElement {
  const section = element('div');
  const label = element('label');
  label.textContent = labelText;
  const choices = element('div', 'choices');
  for (const value of values) {
    const item = button(value, () => update(value));
    item.setAttribute('aria-pressed', String(value === selected));
    choices.append(item);
  }
  section.append(label, choices);
  return section;
}

function monthInput(labelText: string, value: string, update: (value: string) => void): HTMLLabelElement {
  const label = element('label');
  const text = element('span');
  text.textContent = labelText;
  const input = element('input');
  input.type = 'month';
  input.value = value;
  input.addEventListener('change', () => update(input.value));
  label.append(text, input);
  return label;
}
