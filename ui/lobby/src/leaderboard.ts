/** Keep complete rows in the card, with the full standings available via More. */
export function fitLeaderboard(card: HTMLElement): void {
  const table = card.querySelector<HTMLTableElement>('table');
  const body = table?.tBodies[0];
  if (!table || !body) return;
  const rows = Array.from(body.rows);
  rows.forEach(row => (row.hidden = false));
  const maxHeight = parseFloat(window.getComputedStyle(card).maxHeight);
  if (!Number.isFinite(maxHeight) || !card.getBoundingClientRect().width) return;

  const header = card.querySelector<HTMLElement>('.lobby__leaderboard__header');
  const footer = card.querySelector<HTMLElement>('.lobby__leaderboard__footer');
  let available =
    maxHeight -
    (header?.getBoundingClientRect().height ?? 0) -
    (footer?.getBoundingClientRect().height ?? 0) -
    (table.tHead?.getBoundingClientRect().height ?? 0) -
    2;
  const mine = rows.find(row => row.classList.contains('is-me'));
  const separator = rows.find(row => row.classList.contains('lobby__leaderboard__ellipsis'));
  if (mine) available -= mine.getBoundingClientRect().height;
  if (separator) separator.hidden = true;
  for (const row of rows) {
    if (row === mine || row === separator) continue;
    const height = row.getBoundingClientRect().height;
    row.hidden = height > available;
    if (!row.hidden) available -= height;
  }
}

export function fitLeaderboards(): void {
  document.querySelectorAll<HTMLElement>('.lobby__leaderboard').forEach(card => {
    const fit = () => fitLeaderboard(card);
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    void document.fonts.ready.then(fit);
  });
}
