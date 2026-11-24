import 'chartjs-adapter-dayjs-4';
import { Chart, LinearScale, TimeScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js';

import { reducedMotion } from 'lib/device';

import { fontColor, gridColor } from './index';

type Point = [string, number, string];

export function initModule(): void {
  const root = document.querySelector<HTMLElement>('.correspondence-history');
  if (!root) return;
  const canvas = root.querySelector('canvas')!;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-series]'));
  const value = root.querySelector<HTMLElement>('.correspondence-history__value')!;
  const format = new Intl.DateTimeFormat(site.displayLocale, { dateStyle: 'medium', timeZone: 'UTC' });
  Chart.register(LinearScale, TimeScale, LineController, LineElement, PointElement, Tooltip);

  let chart: Chart<'line', { x: number; y: number }[]> | undefined;
  const modes = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-mode]'));
  const plot = canvas.parentElement!;
  const empty = plot.querySelector<HTMLElement>('.history-empty')!;
  let mode = 'live';
  let variant = 'xiangqi';
  function select() {
    const puzzle = mode === 'puzzle';
    buttons[0].parentElement!.hidden = puzzle;
    modes.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.mode === mode)));
    const button = buttons.find(b => b.dataset.series === mode && b.dataset.variant === variant);
    buttons.forEach(b => {
      b.hidden = b.dataset.series !== mode;
      b.setAttribute('aria-pressed', String(b === button));
    });
    const points: Point[] = JSON.parse(
      puzzle ? plot.dataset.puzzle! : (button!.dataset.livePoints ?? button!.dataset.points!),
    );
    const label = (button?.querySelector('.variant-name') || modes[2]).textContent;
    chart?.destroy();
    chart = undefined;
    value.textContent = '';
    canvas.hidden = !points.length;
    empty.hidden = !!points.length;
    canvas.setAttribute('aria-label', label);
    if (!points.length) return;
    if (!reducedMotion())
      canvas.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0)' }], {
        duration: 330,
        easing: 'ease-out',
      });
    const describe = (i: number) => {
      const [day, score, rank] = points[i];
      return [format.format(Date.parse(day)), rank, score].filter(x => x !== '').join(' · ');
    };
    let index = points.length - 1;
    const announce = () => (value.textContent = label + ' · ' + describe(index));
    announce();
    canvas.tabIndex = 0;
    canvas.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      index = Math.min(points.length - 1, Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)));
      announce();
      const active = [{ datasetIndex: 0, index }];
      chart?.setActiveElements(active);
      if (chart)
        chart.tooltip?.setActiveElements(active, {
          x: chart.scales.x.getPixelForValue(Date.parse(points[index][0])),
          y: chart.scales.y.getPixelForValue(points[index][1]),
        });
      chart?.update('none');
    };
    const color = window.getComputedStyle(plot).color;
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label,
            data: points.map(([day, y]) => ({ x: Date.parse(day), y })),
            borderColor: color,
            backgroundColor: color,
            stepped: 'before',
            pointRadius: points.length > 90 ? 1 : 3,
            pointHoverRadius: 6,
            pointHoverBorderWidth: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'time', time: { minUnit: 'day' }, ticks: { color: fontColor, maxTicksLimit: 5 } },
          y: { ticks: { color: fontColor, precision: 0 }, grid: { color: gridColor } },
        },
        plugins: { tooltip: { callbacks: { title: () => '', label: item => describe(item.dataIndex) } } },
      },
    });
  }
  buttons.forEach(
    b =>
      (b.onclick = () => {
        variant = b.dataset.variant!;
        select();
      }),
  );
  modes.forEach(
    b =>
      (b.onclick = () => {
        mode = b.dataset.mode!;
        select();
      }),
  );
  select();
}
