import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  BarController,
  BarElement,
} from 'chart.js';

import { storage } from 'lib/storage';

import {
  calendar,
  metric,
  observed,
  percentMetrics,
  timeMetrics,
  type Report,
  type Row,
  type Snapshot,
} from './model';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  BarController,
  BarElement,
);
const t = (key: string): string => (i18n.traffic as unknown as Record<string, string>)[key] || key;
const number = new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1 });
const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const periods = ['hour', 'day', 'week', 'month', 'year'];
const sections: Record<
  string,
  { dimension: string; metric: string; metrics: string[]; dimensions: string[] }
> = {
  overview: {
    dimension: 'all',
    metric: 'visitors',
    metrics: [
      'visitors',
      'sessions',
      'page',
      'engagedMs',
      'puzzle_completed',
      'user_registered',
      'game_completed',
    ],
    dimensions: ['all', 'page', 'country', 'device', 'language'],
  },
  acquisition: {
    dimension: 'referrer',
    metric: 'visitors',
    metrics: ['visitors', 'sessions', 'engagedMs', 'puzzle_completed', 'user_registered', 'search_paired'],
    dimensions: [
      'referrer',
      'source',
      'medium',
      'campaign',
      'country',
      'region',
      'city',
      'language',
      'device',
    ],
  },
  pages: {
    dimension: 'page',
    metric: 'engagedMs',
    metrics: [
      'visitors',
      'page',
      'visibleMs',
      'engagedMs',
      'engagement',
      'meanVisit',
      'quickExit',
      'visit_closed',
    ],
    dimensions: ['page', 'activity', 'device', 'language', 'country', 'error'],
  },
  matchmaking: {
    dimension: 'pool',
    metric: 'search_paired',
    metrics: [
      'cta_exposed',
      'cta_clicked',
      'room_entered',
      'search_clicked',
      'search_accepted',
      'search_paired',
      'search_left',
      'search_cancelled',
      'search_failed',
      'round_ready',
      'round_failed',
      'waitP50',
      'waitP90',
      'waitP95',
    ],
    dimensions: ['pool', 'placement', 'outcome', 'country', 'device'],
  },
  puzzles: {
    dimension: 'theme',
    metric: 'puzzle_completed',
    metrics: [
      'puzzle_presented',
      'puzzle_started',
      'puzzle_completed',
      'puzzle_revealed',
      'puzzle_retry',
      'puzzle_next',
      'solvingMs',
      'engagedMs',
      'notation_started',
      'notation_finished',
      'lesson_started',
      'lesson_practice',
    ],
    dimensions: ['theme', 'difficulty', 'outcome', 'mode', 'activity', 'language', 'page'],
  },
  accounts: {
    dimension: 'all',
    metric: 'user_registered',
    metrics: ['user_registered', 'visitors', 'engagedMs', 'puzzle_completed', 'search_paired'],
    dimensions: ['all', 'country', 'language', 'referrer', 'device'],
  },
  appearance: {
    dimension: 'board',
    metric: 'boardMs',
    metrics: ['boardMs', 'engagedMs', 'visitors', 'appearance_changed', 'beforeSwitch', 'selectionEpisodes'],
    dimensions: [
      'board',
      'pieces',
      'boardPieces',
      'uiTheme',
      'background',
      'themeBackground',
      'combination',
      'transition',
      'component',
      'colorScheme',
    ],
  },
  audio: {
    dimension: 'music',
    metric: 'engagedMs',
    metrics: [
      'musicShare',
      'effectsShare',
      'playingShare',
      'musicEnabledMs',
      'effectsEnabledMs',
      'musicPlayingMs',
      'engagedMs',
      'audio_changed',
      'visitors',
    ],
    dimensions: ['music', 'sound', 'musicEnabled', 'effectsEnabled', 'device', 'language'],
  },
  quality: {
    dimension: 'all',
    metric: 'page',
    metrics: [
      'page',
      'performance',
      'lcpMs',
      'inpMs',
      'clsMilli',
      'client_error',
      'round_failed',
      'search_failed',
    ],
    dimensions: ['all', 'page', 'device', 'error'],
  },
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function select(name: string, values: string[], value: string): HTMLSelectElement {
  const node = el('select');
  node.name = name;
  node.setAttribute('aria-label', t(name));
  for (const v of values) {
    const option = el('option', t(v));
    option.value = v;
    node.append(option);
  }
  node.value = value;
  return node;
}
function format(value: number, key: string): string {
  if (key === 'clsMilli') return (value / 1000).toFixed(3);
  if (percentMetrics.has(key)) return `${number.format(value)}%`;
  if (timeMetrics.has(key))
    return value >= 3_600_000
      ? `${number.format(value / 3_600_000)} ${t('hoursUnit')}`
      : `${number.format(value / 1000)} ${t('secondsUnit')}`;
  return number.format(value);
}

export function initModule(): void {
  const privacy = document.querySelector<HTMLFormElement>('[data-traffic-privacy]');
  if (privacy) {
    privacy.addEventListener('submit', () =>
      storage.set('traffic.optOut', privacy.querySelector<HTMLInputElement>('input')!.checked ? '1' : '0'),
    );
    return;
  }
  const root = document.getElementById('traffic-app');
  if (root) new Dashboard(root);
}

class Dashboard {
  private section = 'overview';
  private chart?: Chart;
  private generation = 0;
  private controller?: AbortController;
  private report?: Report;
  private snapshot?: Snapshot;
  private comparison?: Report;
  private key = '';
  private readonly form = el('form', undefined, 'traffic__filters');
  private readonly from = el('input');
  private readonly until = el('input');
  private readonly grain = select('grain', periods, 'day');
  private readonly audience = select('audience', ['everyone', 'registered', 'anonymous'], 'everyone');
  private readonly dimension = select('dimension', sections.overview.dimensions, 'all');
  private readonly measurement = select('measurement', sections.overview.metrics, 'visitors');
  private readonly compare = el('input');
  private readonly cumulative = el('input');
  private readonly content = el('div');
  private readonly status = el('p', '', 'traffic__status');
  private readonly tabs = el('nav', undefined, 'traffic__tabs');

  constructor(private readonly root: HTMLElement) {
    const today = new Date();
    this.until.type = this.from.type = 'date';
    this.from.value = dateOnly(new Date(today.getTime() - 29 * 86_400_000));
    this.until.value = dateOnly(today);
    this.compare.type = this.cumulative.type = 'checkbox';
    const saved = new URLSearchParams(location.search);
    if (saved.has('from')) this.from.value = saved.get('from')!;
    if (saved.has('to')) this.until.value = saved.get('to')!;
    if (periods.includes(saved.get('grain')!)) this.grain.value = saved.get('grain')!;
    for (const name of Object.keys(sections)) {
      const button = el('button', t(name));
      button.type = 'button';
      button.dataset.section = name;
      button.addEventListener('click', () => this.choose(name));
      this.tabs.append(button);
    }
    for (const [name, control] of [
      ['from', this.from],
      ['to', this.until],
      ['grain', this.grain],
      ['audience', this.audience],
      ['dimension', this.dimension],
      ['measurement', this.measurement],
      ['compare', this.compare],
      ['cumulative', this.cumulative],
    ] as const) {
      const label = el('label', t(name));
      label.append(control);
      this.form.append(label);
    }
    const update = el('button', t('apply'), 'button');
    update.type = 'submit';
    this.form.append(update);
    const csv = el('button', t('exportCsv'), 'button button-empty');
    csv.type = 'button';
    csv.addEventListener('click', () => {
      location.href = '/report/traffic/export?' + this.params();
    });
    this.form.append(csv);
    this.form.addEventListener('submit', e => {
      e.preventDefault();
      void this.load();
    });
    this.dimension.addEventListener('change', () => {
      this.key = '';
    });
    this.measurement.addEventListener('change', () => this.render());
    this.cumulative.addEventListener('change', () => this.render());
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.root.replaceChildren(this.tabs, this.form, this.status, this.content);
    this.choose(saved.get('section') || 'overview');
  }

  private choose(name: string): void {
    this.section = name in sections ? name : 'overview';
    this.key = '';
    const section = sections[this.section];
    for (const button of this.tabs.querySelectorAll('button'))
      button.setAttribute('aria-current', String(button.dataset.section === this.section));
    for (const [control, choices, value] of [
      [this.dimension, section.dimensions, section.dimension],
      [this.measurement, section.metrics, section.metric],
    ] as const) {
      control.replaceChildren(
        ...choices.map(choice => {
          const opt = el('option', t(choice));
          opt.value = choice;
          return opt;
        }),
      );
      control.value = value;
    }
    void this.load();
  }

  private params(): URLSearchParams {
    const until = new Date(this.until.value);
    until.setUTCDate(until.getUTCDate() + 1);
    return new URLSearchParams({
      from: this.from.value,
      until: dateOnly(until),
      grain: this.grain.value,
      audience: this.audience.value,
      dimension: this.dimension.value,
      ...(this.key ? { key: this.key } : {}),
    });
  }

  private async load(): Promise<void> {
    const games = this.measurement.querySelector<HTMLOptionElement>('option[value="game_completed"]');
    if (games) {
      games.disabled = this.audience.value !== 'everyone';
      if (games.disabled && this.measurement.value === games.value) this.measurement.value = 'visitors';
    }
    const generation = ++this.generation;
    this.controller?.abort();
    this.controller = new AbortController();
    this.status.textContent = t('loading');
    this.root.setAttribute('aria-busy', 'true');
    try {
      const params = this.params();
      const request = async (url: string): Promise<unknown> => {
        const response = await fetch(url, {
          signal: this.controller!.signal,
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!response.ok) throw new Error(t('loadError'));
        return response.json();
      };
      const previous = new URLSearchParams(params);
      const width = new Date(params.get('until')!).getTime() - new Date(params.get('from')!).getTime();
      previous.set('until', params.get('from')!);
      previous.set('from', dateOnly(new Date(new Date(params.get('from')!).getTime() - width)));
      const [report, snapshot, comparison] = await Promise.all([
        request('/report/traffic/data?' + params),
        ['appearance', 'accounts', 'audio'].includes(this.section)
          ? request('/report/traffic/snapshot')
          : undefined,
        this.compare.checked ? request('/report/traffic/data?' + previous) : undefined,
      ]);
      if (generation !== this.generation) return;
      this.report = report as Report;
      this.snapshot = snapshot as Snapshot | undefined;
      this.comparison = comparison as Report | undefined;
      history.replaceState(
        null,
        '',
        '?' +
          new URLSearchParams({
            section: this.section,
            from: this.from.value,
            to: this.until.value,
            grain: this.grain.value,
          }),
      );
      this.status.textContent = `${t('utc')} · ${t('updated')}: ${this.report.quality.processedAt ? new Date(this.report.quality.processedAt).toLocaleString() : t('pending')}`;
      this.render();
    } catch (error) {
      if (generation === this.generation && !(error instanceof DOMException && error.name === 'AbortError')) {
        this.report = undefined;
        this.snapshot = undefined;
        this.comparison = undefined;
        this.chart?.destroy();
        this.chart = undefined;
        this.content.replaceChildren();
        this.status.textContent = t('loadError');
      }
    } finally {
      if (generation === this.generation) this.root.setAttribute('aria-busy', 'false');
    }
  }

  private render(): void {
    if (!this.report) return;
    const report = this.report;
    const key = this.measurement.value;
    const additive =
      ![
        'visitors',
        'sessions',
        'participants',
        'waitP50',
        'waitP90',
        'waitP95',
        'meanVisit',
        'lcpMs',
        'inpMs',
        'clsMilli',
        'beforeSwitch',
      ].includes(key) && !percentMetrics.has(key);
    this.cumulative.disabled = !additive;
    const cumulative = additive && this.cumulative.checked;
    this.chart?.destroy();
    this.content.replaceChildren();
    this.content.append(el('p', t(this.section + 'Help'), 'traffic__help'));
    if (this.key) {
      const clear = el('button', `${this.label(this.key)} ×`, 'button button-empty');
      clear.addEventListener('click', () => {
        this.key = '';
        void this.load();
      });
      this.content.append(clear);
    }
    const cards = el('div', undefined, 'traffic__cards');
    for (const m of [...new Set([key, ...sections[this.section].metrics])].slice(0, 4)) {
      const card = el('div', undefined, 'traffic__card');
      card.append(
        el('span', t(m)),
        el('strong', observed(report.summary, m) ? format(metric(report.summary, m), m) : '—'),
      );
      if (m === 'visitors')
        card.append(
          el(
            'small',
            `${t('estimateRange')}: ${number.format(report.summary.visitorsLower)}–${number.format(report.summary.visitorsUpper)}`,
          ),
        );
      if (this.comparison) {
        const before = metric(this.comparison.summary, m);
        const after = metric(report.summary, m);
        card.append(
          el(
            'small',
            before
              ? `${after >= before ? '+' : ''}${number.format((100 * (after - before)) / before)}% ${t('versusPrevious')}`
              : t('noBaseline'),
          ),
        );
      }
      cards.append(card);
    }
    this.content.append(cards);
    const chartWrap = el('div', undefined, 'traffic__chart');
    const canvas = el('canvas');
    canvas.setAttribute('aria-label', t(key));
    canvas.setAttribute('role', 'img');
    chartWrap.append(canvas);
    this.content.append(chartWrap);
    const series = calendar(report);
    const values = (rows: Row[], source: Report): (number | null)[] => {
      let total = key === 'user_registered' ? source.registrationBaseline || 0 : 0;
      return rows.map(row => {
        if (
          !observed(row, key) ||
          (source.smallCellsSuppressed && !source.series.some(measured => measured.at === row.at))
        )
          return null;
        return cumulative ? (total += metric(row, key)) : metric(row, key);
      });
    };
    const color = window.getComputedStyle(this.root.querySelector('button.button')!).backgroundColor;
    const textColor = window.getComputedStyle(this.root).color;
    this.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map(row => row.at!.slice(0, report.grain === 'hour' ? 16 : 10)),
        datasets: [
          {
            label: t(key),
            data: values(series, report),
            borderColor: color,
            backgroundColor: color,
            tension: 0.1,
            pointRadius: series.length > 90 ? 0 : 2,
          },
          ...(this.comparison
            ? [
                {
                  label: t('previousPeriod'),
                  data: values(calendar(this.comparison), this.comparison),
                  borderColor: textColor,
                  borderDash: [5, 5],
                  pointRadius: 0,
                },
              ]
            : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${format(ctx.parsed.y || 0, key)}` } },
        },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 12 } },
          y: {
            beginAtZero: true,
            ticks: { color: textColor, callback: value => format(Number(value), key) },
          },
        },
      },
    });
    if (report.smallCellsSuppressed) this.content.append(el('p', t('smallCellsNotes')));
    if (key === 'user_registered' && cumulative) this.content.append(el('p', t('cumulativeNotes')));
    if (!report.series.length) this.content.append(el('p', t('noData'), 'traffic__empty'));
    this.renderTable(report.groups, key);
    if (this.snapshot) this.renderSnapshot(this.snapshot);
    if (['matchmaking', 'accounts', 'audio'].includes(this.section)) void this.renderCohort();
    if (this.section === 'appearance') this.content.append(el('p', t('selectionNotes')));
    if (this.section === 'quality') {
      this.content.append(el('p', t('performanceNotes')));
      void this.renderHealth();
    }
    const definitions = el('details', undefined, 'traffic__definitions');
    definitions.append(
      el('summary', t('definitions')),
      el('p', t('measurementNotes')),
      el('p', t('retentionNotes')),
      el('p', t('coverageNotes')),
    );
    this.content.append(definitions);
  }

  private label(value: string): string {
    const appearance = this.report?.catalog.appearance || {};
    if (this.dimension.value === 'boardPieces')
      return value
        .split('|')
        .map((v, i) => appearance[i ? 'pieces' : 'board']?.[v] || v)
        .join(' + ');
    if (this.dimension.value === 'combination')
      return value
        .split('|')
        .map(
          (v, i) => appearance[['uiTheme', 'background', 'board', 'pieces', 'sound', 'music'][i]]?.[v] || v,
        )
        .join(' + ');
    return appearance[this.dimension.value]?.[value] || (value === 'all' ? t('all') : value);
  }

  private renderTable(rows: Row[], key: string): void {
    const wrap = el('div', undefined, 'traffic__table');
    const table = el('table', undefined, 'slist');
    const columns = [...new Set([key, 'visitors', 'engagedMs'])];
    const header = el('tr');
    header.append(el('th', t(this.dimension.value)));
    for (const m of columns) header.append(el('th', t(m)));
    header.append(el('th', t('share')));
    const head = el('thead');
    head.append(header);
    table.append(head);
    const body = el('tbody');
    const sorted = [...rows].sort((a, b) => metric(b, key) - metric(a, key));
    const total = sorted.reduce((sum, row) => sum + metric(row, key), 0);
    for (const row of sorted.slice(0, 100)) {
      const tr = el('tr');
      const category = el('td');
      const button = el('button', this.label(row.key!));
      button.addEventListener('click', () => {
        this.key = row.key!;
        void this.load();
      });
      category.append(button);
      tr.append(category);
      for (const m of columns) tr.append(el('td', observed(row, m) ? format(metric(row, m), m) : '—'));
      tr.append(
        el(
          'td',
          total &&
            !percentMetrics.has(key) &&
            ![
              'waitP50',
              'waitP90',
              'waitP95',
              'meanVisit',
              'lcpMs',
              'inpMs',
              'clsMilli',
              'beforeSwitch',
            ].includes(key)
            ? `${number.format((100 * metric(row, key)) / total)}%`
            : '—',
        ),
      );
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    this.content.append(wrap, el('p', t('tableNotes'), 'traffic__caption'));
  }

  private renderSnapshot(snapshot: Snapshot): void {
    const section = el('section', undefined, 'traffic__snapshot');
    section.append(el('h2', t('savedPreferences')), el('p', t('snapshotNotes')));
    section.append(el('p', `${t('snapshotDate')}: ${snapshot.day?.slice(0, 10) || t('pending')}`));
    const dimension =
      this.section === 'accounts'
        ? ['country', 'language'].includes(this.dimension.value)
          ? this.dimension.value
          : 'accounts'
        : this.dimension.value;
    const rows = snapshot.rows.filter(row => row.dimension === dimension).sort((a, b) => b.count - a.count);
    const population =
      snapshot.rows.find(row => row.dimension === 'accounts' && row.key === 'enabled')?.count || 0;
    const list = el('div', undefined, 'traffic__histogram');
    for (const row of rows.slice(0, 100)) {
      const entry = el('div');
      entry.append(
        el('span', this.label(row.key)),
        el(
          'strong',
          `${number.format(row.count)}${dimension !== 'accounts' && population ? ' · ' + number.format((100 * row.count) / population) + '%' : ''}`,
        ),
      );
      const bar = el('meter');
      bar.max = Math.max(1, population, row.count);
      bar.value = row.count;
      bar.setAttribute('aria-label', this.label(row.key));
      entry.append(bar);
      list.append(entry);
    }
    section.append(list);
    this.content.append(section);
  }

  private async renderHealth(): Promise<void> {
    const generation = this.generation;
    try {
      const response = await fetch('/report/traffic/health');
      if (!response.ok) return;
      const health = (await response.json()) as Record<string, unknown>;
      if (generation !== this.generation || this.section !== 'quality') return;
      const dl = el('dl', undefined, 'traffic__health');
      for (const key of [
        'enabled',
        'buffered',
        'dropped',
        'rejected',
        'geoAvailable',
        'measurementStartedAt',
        'oldestPendingAt',
        'processedAt',
        'retention',
      ])
        dl.append(el('dt', t(key)), el('dd', String(health[key] ?? t('pending'))));
      this.content.append(dl);
    } catch {
      /* Main report remains usable when the health request fails. */
    }
  }

  private async renderCohort(): Promise<void> {
    const generation = this.generation;
    const section = el('section', undefined, 'traffic__snapshot');
    const kind = this.section;
    section.append(
      el(
        'h2',
        t(
          kind === 'matchmaking' ? 'attemptCohort' : kind === 'accounts' ? 'retentionCohort' : 'currentAudio',
        ),
      ),
    );
    section.append(
      el(
        'p',
        t(
          kind === 'matchmaking'
            ? 'cohortNotes'
            : kind === 'accounts'
              ? 'retentionHelp'
              : 'audioSnapshotHelp',
        ),
      ),
    );
    const status = el('p', t('loading'));
    section.append(status);
    this.content.append(section);
    try {
      const response = await fetch(
        `/report/traffic/${kind === 'matchmaking' ? 'searches' : kind === 'accounts' ? 'returns' : 'audio'}?${this.params()}`,
      );
      if (!response.ok) throw new Error('Cohort unavailable');
      const result = (await response.json()) as {
        accepted: number;
        paired: number;
        roundReady: number;
        firstMove: number;
        aborted: number;
        left: number;
        unresolved: number;
        size: number;
        activated: number | null;
        browsers: number;
        musicEnabled: number;
        users: number;
        musicAccounts: number;
        effectsAccounts: number;
        effectsEnabled: number;
        returns: { day: number; eligible: number; returned: number | null }[];
      };
      if (generation !== this.generation || kind !== this.section) return;
      status.remove();
      const cards = el('div', undefined, 'traffic__cards');
      const card = (name: string, value: string) => {
        const item = el('div', undefined, 'traffic__card');
        item.append(el('span', t(name)), el('strong', value));
        cards.append(item);
      };
      if (kind === 'matchmaking') {
        for (const key of [
          'accepted',
          'paired',
          'roundReady',
          'firstMove',
          'aborted',
          'left',
          'unresolved',
        ] as const)
          card(key, number.format(result[key]));
        card(
          'pairingRate',
          result.accepted ? `${number.format((100 * result.paired) / result.accepted)}%` : '—',
        );
      } else if (kind === 'accounts') {
        card('cohortSize', number.format(result.size));
        card(
          'activated',
          result.activated === null
            ? t('smallSample')
            : `${number.format(result.activated)} / ${number.format(result.size)}`,
        );
        for (const row of result.returns)
          card(
            row.day === 1 ? 'dayOne' : row.day === 7 ? 'daySeven' : 'dayThirty',
            row.returned === null
              ? t('smallSample')
              : row.eligible
                ? `${number.format((100 * row.returned) / row.eligible)}% (${row.returned}/${row.eligible})`
                : t('pending'),
          );
      } else {
        card('observedAccounts', number.format(result.users));
        for (const key of ['musicAccounts', 'effectsAccounts'] as const)
          card(
            key,
            result.users
              ? `${number.format((100 * result[key]) / result.users)}% (${result[key]}/${result.users})`
              : '—',
          );
        card('registeredBrowsers', number.format(result.browsers));
        for (const key of ['musicEnabled', 'effectsEnabled'] as const)
          card(
            key,
            result.browsers
              ? `${number.format((100 * result[key]) / result.browsers)}% (${result[key]}/${result.browsers})`
              : '—',
          );
      }
      section.append(cards);
    } catch {
      if (generation === this.generation) status.textContent = t('loadError');
    }
  }
}
