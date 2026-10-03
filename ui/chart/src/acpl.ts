import {
  type ChartConfiguration,
  type ChartDataset,
  type PointStyle,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

import { plyToTurn } from 'lib/game/chess';
import { pubsub } from 'lib/pubsub';

import division from './division';
import { evaluationLabel, evaluationValue } from './evaluation';
import {
  blackFill,
  fontColor,
  fontFamily,
  maybeChart,
  orangeAccent,
  plyLine,
  selectPly,
  tooltipBgColor,
  redFill,
  axisOpts,
} from './index';
import type { AcplChart, AnalyseData, EvaluationChartOptions, EvaluationNode, Player } from './interface';

Chart.register(LineController, LinearScale, PointElement, LineElement, Tooltip, Filler, ChartDataLabels);
export default async function (
  el: HTMLCanvasElement,
  data: AnalyseData,
  mainline: EvaluationNode[],
  options: EvaluationChartOptions = {},
): Promise<AcplChart> {
  const possibleChart = maybeChart(el);
  if (possibleChart) return possibleChart as AcplChart;
  const blurBackgroundColorRed = redFill;
  const blurBackgroundColorBlack = 'black';
  const ply = plyLine(0);
  const divisionLines = division(data.game.division);
  const firstPly = mainline[0].ply;
  const isPartial = (d: AnalyseData) => !d.analysis || !!d.analysis.partial;

  const makeDataset = (
    d: AnalyseData,
    mainline: EvaluationNode[],
  ): { acpl: ChartDataset<'line'>; moveLabels: string[]; adviceHoverColors: string[] } => {
    const pointBackgroundColors: (
      | typeof orangeAccent
      | typeof blurBackgroundColorRed
      | typeof blurBackgroundColorBlack
    )[] = [];
    const adviceHoverColors: string[] = [];
    const moveLabels: string[] = [];
    const pointStyles: PointStyle[] = [];
    const pointSizes: number[] = [];
    const winChances: { x: number; y: number }[] = [];
    const blurs = [toBlurArray(d.player), toBlurArray(d.opponent)];
    if (d.player.color === 'red') blurs.reverse();
    mainline.slice(1).map(node => {
      const isRed = (node.ply & 1) === 1;
      const turn = plyToTurn(node.ply);
      const dots = isRed ? '.' : '...';
      const winchance = evaluationValue(node);
      // Plot winchance because logarithmic but display the corresponding cp.eval from AnalyseData in the tooltip
      // Chart.js skips non-finite points and leaves a gap for missing analysis.
      winChances.push({ x: node.ply, y: winchance ?? NaN });

      const { advice, color: glyphColor } = glyphProperties(node);
      const side = `${isRed ? i18n.site.red : i18n.site.black} `;
      const label = `${turn}${dots} ${side}${node.notation ?? ''}`;
      let annotation = '';
      if (advice) annotation = ` [${i18n.site[advice]}]`;
      const isBlur =
        blurs[isRed ? 1 : 0][Math.floor((node.ply - (d.game.startedAtTurn || 0) - 1) / 2)] === '1';
      if (isBlur) annotation = ' [blur]';
      moveLabels.push(label + annotation);
      pointStyles.push(isBlur ? 'rect' : 'circle');
      pointSizes.push(isBlur ? 5 : 0);
      pointBackgroundColors.push(
        isBlur ? (isRed ? blurBackgroundColorRed : blurBackgroundColorBlack) : orangeAccent,
      );
      adviceHoverColors.push(glyphColor ?? orangeAccent);
    });
    return {
      acpl: {
        label: i18n.site.advantage,
        data: winChances,
        borderWidth: 1,
        fill: {
          target: 'origin',
          below: blackFill,
          above: redFill,
        },
        pointRadius: d.player.blurs || d.opponent.blurs ? pointSizes : 0,
        pointHoverRadius: 5,
        pointHitRadius: 100,
        borderColor: orangeAccent,
        pointBackgroundColor: pointBackgroundColors,
        pointStyle: pointStyles,
        hoverBackgroundColor: orangeAccent,
        order: 5,
        datalabels: { display: false },
      },
      moveLabels,
      adviceHoverColors,
    };
  };

  const dataset = makeDataset(data, mainline);
  const acpl = dataset.acpl;
  let moveLabels = dataset.moveLabels;
  let adviceHoverColors = dataset.adviceHoverColors;
  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: moveLabels.map((_, index) => index),
      datasets: [acpl, ply, ...divisionLines],
    },
    options: {
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
      scales: axisOpts(firstPly + 1, Math.max(firstPly + 2, mainline[mainline.length - 1].ply)),
      animation: false,
      maintainAspectRatio: false,
      responsive: true,
      plugins: {
        tooltip: {
          borderColor: fontColor,
          borderWidth: 1,
          backgroundColor: tooltipBgColor,
          bodyColor: fontColor,
          titleColor: fontColor,
          titleFont: fontFamily(14, 'bold'),
          bodyFont: fontFamily(13),
          caretPadding: 10,
          displayColors: false,
          filter: item => item.datasetIndex === 0,
          callbacks: {
            label: item => {
              const node = mainline[item.dataIndex + 1];
              return node ? `${i18n.site.advantage}: ${evaluationLabel(node)}` : '';
            },
            title: items => (items[0] ? moveLabels[items[0].dataIndex] : ''),
          },
        },
      },
      onClick(_event, elements, _chart) {
        const data = elements[elements.findIndex(element => element.datasetIndex === 0)];
        if (data) {
          if (options.onSelect) options.onSelect(mainline[data.index + 1].ply);
          else pubsub.emit('analysis.chart.click', data.index);
        }
      },
    },
  };
  const acplChart = new Chart(el, config) as AcplChart;
  acplChart.selectPly = selectPly.bind(acplChart);
  let unbindAdvice = () => {};
  acplChart.updateData = (d: AnalyseData, nodes: EvaluationNode[]) => {
    data = d;
    mainline = nodes;
    const dataset = makeDataset(data, mainline);
    moveLabels = dataset.moveLabels;
    adviceHoverColors = dataset.adviceHoverColors;
    acplChart.data.datasets[0] = dataset.acpl;
    acplChart.data.labels = moveLabels.map((_, index) => index);
    acplChart.options.scales = axisOpts(
      mainline[0].ply + 1,
      Math.max(mainline[0].ply + 2, mainline[mainline.length - 1].ply),
    );
    unbindAdvice();
    if (!isPartial(data)) unbindAdvice = christmasTree(acplChart, mainline, adviceHoverColors);
    acplChart.update('none');
  };
  if (!options.onSelect) {
    pubsub.on('ply', acplChart.selectPly);
    pubsub.emit('ply.trigger');
  }
  if (!isPartial(data)) unbindAdvice = christmasTree(acplChart, mainline, adviceHoverColors);
  const destroy = acplChart.destroy.bind(acplChart);
  acplChart.destroy = () => {
    pubsub.off('ply', acplChart.selectPly);
    unbindAdvice();
    destroy();
  };
  return acplChart;
}

type Advice = 'blunder' | 'mistake' | 'inaccuracy';
const glyphProperties = (node: EvaluationNode): { advice?: Advice; color?: string } => {
  if (node.glyphs?.some(g => g.id === 4)) return { advice: 'blunder', color: '#db3031' };
  else if (node.glyphs?.some(g => g.id === 2)) return { advice: 'mistake', color: '#e69d00' };
  else if (node.glyphs?.some(g => g.id === 6)) return { advice: 'inaccuracy', color: '#4da3d5' };
  else return { advice: undefined, color: undefined };
};

const toBlurArray = (player: Player) => player.blurs?.bits?.split('') ?? [];

function christmasTree(chart: AcplChart, mainline: EvaluationNode[], hoverColors: string[]) {
  const summary = $('div.advice-summary');
  const enter = function (this: HTMLElement) {
    if (!chart.canvas.isConnected) return;
    const symbol = this.getAttribute('data-symbol');
    const playerColorBit = this.getAttribute('data-color') === 'red' ? 1 : 0;
    const acplDataset = chart.data.datasets[0];
    if (symbol === '??' || symbol === '?!' || symbol === '?') {
      acplDataset.pointHoverBackgroundColor = hoverColors;
      acplDataset.pointBorderColor = hoverColors;
      const points = mainline
        .filter(
          node => node.glyphs?.some(glyph => glyph.symbol === symbol) && (node.ply & 1) === playerColorBit,
        )
        .map(node => ({ datasetIndex: 0, index: node.ply - mainline[0].ply - 1 }));
      chart.setActiveElements(points);
      chart.update('none');
    }
  };
  const leave = () => {
    if (!chart.canvas.isConnected) return;
    chart.setActiveElements([]);
    chart.data.datasets[0].pointHoverBackgroundColor = orangeAccent;
    chart.data.datasets[0].pointBorderColor = orangeAccent;
    chart.update('none');
  };
  summary.on('mouseenter', 'div.symbol', enter).on('mouseleave', 'div.symbol', leave);
  return () => {
    summary.off('mouseenter', enter).off('mouseleave', leave);
  };
}
