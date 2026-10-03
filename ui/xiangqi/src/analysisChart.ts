import type { AcplChart, AnalyseData, ChartGame, EvaluationNode } from 'chart';

import {
  getNodeList,
  mainlineEndPath,
  type XiangqiMoveTree,
  type XiangqiPositionNode,
} from 'lib/tree/native';

export function chartNodes(nodes: XiangqiPositionNode[]): EvaluationNode[] {
  return nodes.map(node => ({
    ply: node.state.ply,
    notation: 'notation' in node ? node.notation : '',
    ...(node.evaluation ? { eval: { cp: node.evaluation.cp, mate: node.evaluation.mate } } : {}),
  }));
}

export class AnalysisChart {
  private chart?: AcplChart;
  private loading?: Promise<void>;
  private tree?: XiangqiMoveTree;
  private nodes: XiangqiPositionNode[] = [];
  private signature = '';
  private activePath = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly navigate: (path: string) => void,
    private readonly onError: (error: unknown) => void,
  ) {
    canvas.addEventListener('keydown', event => {
      const index = this.nodes.findIndex(node => node.path === this.activePath);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? this.nodes.length - 1
            : event.key === 'ArrowLeft'
              ? Math.max(0, index - 1)
              : event.key === 'ArrowRight'
                ? Math.min(this.nodes.length - 1, index + 1)
                : undefined;
      if (next === undefined || !this.nodes[next]) return;
      event.preventDefault();
      event.stopPropagation();
      this.navigate(this.nodes[next].path);
    });
  }

  render(tree: XiangqiMoveTree, activePath: string): void {
    this.activePath = activePath;
    const nodes = getNodeList(tree, mainlineEndPath(tree));
    const mainline = chartNodes(nodes);
    const available = mainline
      .slice(1)
      .some(node => node.eval?.cp !== undefined || node.eval?.mate !== undefined);
    this.container.hidden = !available;
    if (!available) {
      this.chart?.destroy();
      this.chart = undefined;
      this.tree = tree;
      this.nodes = nodes;
      this.signature = '';
      return;
    }
    const signature = JSON.stringify(mainline);
    const changed = this.tree !== tree || this.signature !== signature;
    this.tree = tree;
    this.nodes = nodes;
    this.signature = signature;
    const data: AnalyseData = {
      player: { color: 'red' },
      opponent: { color: 'black' },
      tree: tree.root,
      game: { variant: { key: 'xiangqi' }, status: { name: 'finished' } },
      analysis: {},
    };
    if (this.chart) {
      if (changed) this.chart.updateData(data, mainline);
      this.select();
    } else if (!this.loading) {
      this.loading = site.asset
        .loadEsm<ChartGame>('chart.game')
        .then(async module => {
          // The active tab may have changed while the chart bundle downloaded.
          if (this.container.hidden || !this.canvas.isConnected) return;
          const chart = await module.acpl(this.canvas, data, chartNodes(this.nodes), {
            onSelect: ply => {
              const node = this.nodes.find(node => node.state.ply === ply);
              if (node) this.navigate(node.path);
            },
          });
          if (this.container.hidden || !this.canvas.isConnected) {
            chart.destroy();
            return;
          }
          this.chart = chart;
          this.chart.updateData(data, chartNodes(this.nodes));
          this.select();
        })
        .catch(this.onError)
        .finally(() => {
          this.loading = undefined;
        });
    }
  }

  private select(): void {
    const node = this.tree?.nodeAtPath(this.activePath);
    if (node) this.chart?.selectPly(node.state.ply, this.nodes.includes(node));
  }
}
