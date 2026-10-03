import type { AcplChart, ChartGame } from 'chart';
import { h, type VNode } from 'snabbdom';

import { requestIdleCallbackSafe } from 'lib';
import { bind } from 'lib/view';
import { json } from 'lib/xhr';

import type AnalyseCtrl from '../ctrl';
import { LocalAnalysisRun, type AnalysisBatch } from './localAnalysisRun';
import { hasStoredEvaluations } from './sourceGameAnalysis';

export default class LocalAnalysis {
  chart?: AcplChart;
  running = false;
  saving = false;
  failed = false;
  done = 0;
  total = 0;
  download?: number;
  private run?: LocalAnalysisRun;
  private pending?: { chapter: string; batch: AnalysisBatch };
  private generation = 0;
  constructor(
    readonly root: AnalyseCtrl,
    readonly chapterId: () => string,
  ) {
    window.addEventListener('pagehide', this.reset);
  }
  reset = () => {
    this.generation++;
    this.run?.cancel();
    this.run = undefined;
    this.running = this.saving = this.failed = false;
    this.pending = undefined;
    this.download = undefined;
  };
  cancel = () => {
    this.reset();
    this.root.redraw();
  };
  available = () => hasStoredEvaluations(this.root.mainline);
  request = async () => {
    if (this.running || !this.root.study!.members.canContribute()) return;
    const generation = ++this.generation;
    const chapter = this.chapterId();
    this.running = true;
    this.failed = false;
    this.done = 0;
    this.total = this.root.mainline.length;
    this.root.cevalEnabled(false);
    this.root.ceval.reset();
    this.root.redraw();
    try {
      if (!this.pending || this.pending.chapter !== chapter) {
        this.run = new LocalAnalysisRun();
        const batch = await this.run.run(
          [...this.root.mainline],
          this.root.tree.root.ruleset!,
          (done, status) => {
            if (generation !== this.generation) return;
            this.done = done;
            this.download =
              status?.state === 'downloading' && status.total
                ? Math.floor((status.bytes * 100) / status.total)
                : undefined;
            this.root.redraw();
          },
        );
        if (generation !== this.generation) return;
        this.pending = { chapter, batch };
      }
      this.saving = true;
      this.root.redraw();
      await json(`/study/${this.root.study!.data.id}/${chapter}/local-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.pending.batch),
        signal: AbortSignal.timeout(15000),
      });
      if (generation !== this.generation) return;
      this.pending = undefined;
      await this.root.study!.xhrReload();
    } catch {
      if (generation === this.generation) this.failed = true;
    } finally {
      if (generation === this.generation) {
        this.running = this.saving = false;
        this.run = undefined;
        this.root.redraw();
      }
    }
  };
}

export function view(ctrl: LocalAnalysis): VNode {
  const root = ctrl.root;
  const controls: VNode[] = [h('p', i18n.study.browserAnalysisDescription)];
  if (ctrl.running) {
    controls.push(
      h(
        'p',
        { attrs: { role: 'status' } },
        ctrl.saving
          ? i18n.study.savingAnalysis
          : `${i18n.study.evaluating} ${ctrl.download !== undefined ? `${ctrl.download}%` : `${ctrl.done}/${ctrl.total}`}`,
      ),
    );
    if (!ctrl.saving)
      controls.push(h('button.button', { hook: bind('click', ctrl.cancel) }, i18n.site.cancel));
  } else if (root.study!.members.canContribute()) {
    if (ctrl.failed) controls.push(h('p', { attrs: { role: 'alert' } }, i18n.study.localAnalysisFailed));
    controls.push(
      h(
        'button.button',
        { attrs: { type: 'button', disabled: root.mainline.length < 2 }, hook: bind('click', ctrl.request) },
        ctrl.failed ? i18n.site.retry : i18n.site.requestAComputerAnalysis,
      ),
    );
    if (ctrl.failed)
      controls.push(h('button.button.button-empty', { hook: bind('click', ctrl.cancel) }, i18n.site.cancel));
  } else controls.push(h('p', i18n.study.onlyContributorsCanRequestAnalysis));
  const content: VNode[] = [h('div.study__message', controls)];
  if (root.settings.showStaticAnalysis && ctrl.available())
    content.unshift(
      h('div.study__analysis-chart', [
        h('canvas', {
          key: ctrl.chapterId(),
          hook: {
            insert: vnode => {
              const canvas = vnode.elm as HTMLCanvasElement;
              requestIdleCallbackSafe(async () => {
                const module = await site.asset.loadEsm<ChartGame>('chart.game');
                if (canvas.isConnected) ctrl.chart = await module.acpl(canvas, root.data, root.mainline);
              }, 100);
            },
            update: () => ctrl.chart?.updateData(root.data, root.mainline),
            destroy: vnode => {
              const chart = ctrl.chart;
              if (chart && chart.canvas === vnode.elm) {
                chart.destroy();
                ctrl.chart = undefined;
              }
            },
          },
        }),
      ]),
    );
  return h('div.study__server-eval', content);
}
