import { colors, turnOrder, terminalShares, el, type State, type Tree } from 'threeKingdoms';

/** The same labelled colors and percentages are used by the strip and history. */
export function balanceLabels(shares?: number[], state?: State, compact = false): HTMLElement {
  const labels = el('div', 'kingdom-balance__labels');
  for (const color of turnOrder) {
    const i = colors.indexOf(color);
    const label = el('span', `kingdom-balance__label kingdom-color--${color}`);
    const value = shares ? `${Math.round(shares[i])}%` : '—';
    label.title = i18n.threeKingdoms[color];
    const name = compact
      ? { black: i18n.threeKingdoms.wei, green: i18n.threeKingdoms.wu, red: i18n.threeKingdoms.shu }[color]
      : i18n.threeKingdoms[color];
    label.append(el('span', 'kingdom-balance__name', name), el('strong', '', value));
    if (state && !state.active.includes(color)) {
      label.classList.add('eliminated');
      label.title = i18n.threeKingdoms.eliminatedPlayer;
      label.append(el('small', '', i18n.threeKingdoms.eliminatedPlayer));
    }
    labels.append(label);
  }
  return labels;
}

export function renderKingdomBalance(element: HTMLElement, state: State, shares?: number[]): void {
  element.className = 'kingdom-balance';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', i18n.threeKingdoms.positionBalance);
  element.title = i18n.threeKingdoms.balanceHelp;
  const bar = el('div', 'kingdom-balance__bar');
  bar.setAttribute('aria-hidden', 'true');
  bar.classList.toggle('unknown', !shares);
  for (const color of turnOrder) {
    const i = colors.indexOf(color);
    const segment = el('span', `kingdom-color--${color}`);
    segment.style.flexGrow = String(shares?.[i] ?? 1);
    bar.append(segment);
  }
  element.replaceChildren(bar, balanceLabels(shares, state));
}

const svgNs = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const element = document.createElementNS(svgNs, tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
};

/** Independent curves keep all three players on one baseline. No moving middle
 * band, no invented red-vs-everyone score. Missing evaluations remain gaps. */
export class KingdomAnalysisChart {
  private readonly plot = svg('svg', {
    viewBox: '0 0 700 180',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  private readonly labels = el('div');
  private readonly slider = el('input');
  private readonly caption = el('span');
  private nodes: number[] = [];
  private tree?: Tree;
  private positions: Tree['current'][] = [];
  private width = 700;

  constructor(
    private readonly container: HTMLElement,
    navigate: (index: number) => void,
  ) {
    container.classList.add('kingdom-chart');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.step = '1';
    this.slider.setAttribute('aria-label', i18n.threeKingdoms.selectPosition);
    this.slider.addEventListener('input', () => navigate(this.nodes[Number(this.slider.value)]));
    this.slider.addEventListener('keydown', event => event.stopPropagation());
    this.plot.addEventListener('pointerdown', event => {
      const rect = this.plot.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * this.width) / rect.width;
      const index = Math.max(
        0,
        Math.min(this.nodes.length - 1, Math.round(((x - 34) / (this.width - 46)) * (this.nodes.length - 1))),
      );
      navigate(this.nodes[index]);
    });
    const heading = el('div', 'kingdom-chart__heading');
    heading.append(el('strong', '', i18n.threeKingdoms.positionBalance), this.caption);
    container.replaceChildren(
      heading,
      this.labels,
      this.plot,
      this.slider,
      el('p', 'kingdom-chart__help', i18n.threeKingdoms.balanceHelp),
    );
    const observer = new ResizeObserver(() => {
      if (this.tree && container.clientWidth > 0 && container.clientWidth !== this.width)
        this.render(this.tree);
    });
    observer.observe(container);
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  line(tree: Tree): number[] {
    // Keep the displayed branch when selecting one of its ancestors. Rebuild
    // after a tab switch or tree edit, or when entering a different variation.
    if (
      this.tree !== tree ||
      !this.nodes.includes(tree.cursor) ||
      !this.nodes.every((index, i) => tree.nodes[index] === this.positions[i]) ||
      tree.children(this.nodes[this.nodes.length - 1]).length
    ) {
      this.nodes = [0, ...tree.line(tree.last())];
      this.positions = this.nodes.map(i => tree.nodes[i]);
      this.tree = tree;
    }
    return this.nodes;
  }

  render(tree: Tree): void {
    this.line(tree);
    const values = this.nodes.map(
      i => terminalShares(tree.nodes[i].state) ?? tree.nodes[i].evaluation?.shares,
    );
    this.container.hidden = !values.some(Boolean);
    if (this.container.hidden) return;
    this.width = Math.max(250, this.container.clientWidth);
    this.plot.setAttribute('viewBox', `0 0 ${this.width} 180`);
    const x = (index: number) => 34 + (index * (this.width - 46)) / Math.max(1, this.nodes.length - 1);
    const y = (value: number) => 160 - value * 1.5;
    const parts: SVGElement[] = [];
    for (const value of [0, 100 / 3, 100]) {
      parts.push(
        svg('line', {
          x1: 34,
          x2: this.width - 12,
          y1: y(value),
          y2: y(value),
          class: 'kingdom-chart__grid',
        }),
      );
      const text = svg('text', { x: 28, y: y(value) + 4, 'text-anchor': 'end' });
      text.textContent = `${Math.round(value)}%`;
      parts.push(text);
    }
    colors.forEach((color, player) => {
      let path = '',
        connected = false;
      values.forEach((value, i) => {
        if (!value) {
          connected = false;
          return;
        }
        path += `${connected ? 'L' : 'M'}${x(i)},${y(value[player])} `;
        connected = true;
        if (values.length === 1 || (!values[i - 1] && !values[i + 1]))
          parts.push(
            svg('circle', {
              cx: x(i),
              cy: y(value[player]),
              r: 3,
              class: `kingdom-chart__point kingdom-color--${color}`,
            }),
          );
      });
      parts.push(svg('path', { d: path, class: `kingdom-chart__curve kingdom-color--${color}` }));
    });
    const selected = this.nodes.indexOf(tree.cursor);
    parts.push(
      svg('line', { x1: x(selected), x2: x(selected), y1: 7, y2: 164, class: 'kingdom-chart__cursor' }),
    );
    this.plot.replaceChildren(...parts);
    this.slider.max = String(this.nodes.length - 1);
    this.slider.value = String(selected);
    const shares = values[selected];
    const description = i18n.threeKingdoms.positionNumber(selected);
    this.caption.textContent = description;
    this.slider.setAttribute(
      'aria-valuetext',
      description +
        (shares
          ? ' · ' +
            colors.map((color, i) => `${i18n.threeKingdoms[color]} ${Math.round(shares[i])}%`).join(' · ')
          : ''),
    );
    this.labels.replaceChildren(balanceLabels(shares, tree.current.state));
  }
}
