import {
  AnalysisSuggestions,
  analysisSuggestionElements,
  createAnalysisEngineView,
  createAnalysisGauge,
  createAnalysisSettings,
} from 'xiangqi';

import { CevalState } from 'lib/ceval/types';
import { engineSelection } from 'lib/ceval/view/settings';
import { hl, type VNode } from 'lib/view';
import { updateProgressBar } from 'lib/view/progressBar';

import type AnalyseCtrl from '@/ctrl';

import { patch } from './util';

class StudyEngineView {
  readonly engine = createAnalysisEngineView();
  readonly gauge = createAnalysisGauge();
  private readonly elements = analysisSuggestionElements(this.engine, this.gauge);
  private readonly suggestions: AnalysisSuggestions;
  private positionKey = '';
  private chapterKey = '';
  private settingsKey = '';
  private provider?: VNode;
  mounts = 0;

  constructor(private readonly ctrl: AnalyseCtrl) {
    this.suggestions = new AnalysisSuggestions(
      ctrl.node.fen,
      () => ctrl.getOrientation(),
      () => ctrl.ceval.search.multiPv,
      this.elements,
    );
    this.engine
      .querySelector<HTMLInputElement>('input')!
      .addEventListener('change', event => ctrl.cevalEnabled((event.target as HTMLInputElement).checked));
    this.engine.querySelector('button')!.addEventListener('click', () => {
      ctrl.ceval.showEnginePrefs.toggle();
      ctrl.redraw();
    });
    this.elements.moreLines.addEventListener('click', () => this.suggestions.toggleExpanded());
  }

  update(): void {
    const ctrl = this.ctrl;
    const position = ctrl.tree.positionAt(ctrl.path);
    const key = JSON.stringify(position);
    if (key !== this.positionKey) {
      this.positionKey = key;
      this.suggestions.setPosition(ctrl.node.fen, position, moves => ctrl.playUciList(moves));
    }
    const chapterKey = ctrl.study?.currentChapter()?.id ?? ctrl.tree.root.fen;
    if (chapterKey !== this.chapterKey) {
      this.chapterKey = chapterKey;
      this.suggestions.resetEvaluation();
    }
    const settingsKey = ctrl.ceval.engines.active().id;
    if (settingsKey !== this.settingsKey) {
      this.settingsKey = settingsKey;
      const restart = () => {
        ctrl.clearCeval();
        ctrl.redraw();
      };
      const info = ctrl.ceval.info();
      const searchTimes = [2, 4, 6, 8, 10, 12, 15, 20, 30, Infinity].filter(
        seconds => seconds * 1000 <= (ctrl.ceval.engines.active().maxMovetime ?? Infinity),
      );
      const settings = createAnalysisSettings([
        {
          name: 'lines-preview',
          label: 'Show engine lines preview',
          type: 'checkbox',
          value: true,
          change: value => this.suggestions.setPreviewEnabled(Boolean(value)),
        },
        {
          name: 'search-time',
          label: i18n.site.searchTime,
          type: 'range',
          min: 0,
          max: searchTimes.length - 1,
          value: Math.max(
            0,
            searchTimes.findIndex(seconds => seconds * 1000 >= ctrl.ceval.storedMovetime()),
          ),
          format: value => (isFinite(searchTimes[value]) ? searchTimes[value] + 's' : '∞'),
          change: value => {
            ctrl.ceval.storedMovetime(searchTimes[Number(value)] * 1000);
            restart();
          },
        },
        {
          name: 'multipv',
          label: i18n.site.multipleLines,
          type: 'range',
          min: 1,
          max: 5,
          value: ctrl.ceval.storedPv(),
          format: value => value + ' / 5',
          change: value => {
            ctrl.ceval.storedPv(Number(value));
            restart();
          },
        },
        {
          name: 'threads',
          label: i18n.site.threads,
          type: 'range',
          min: ctrl.ceval.engines.active().minThreads ?? 1,
          max: ctrl.ceval.maxThreads,
          value: info.threads,
          change: value => {
            ctrl.ceval.setThreads(Number(value));
            restart();
          },
        },
        {
          name: 'hash',
          label: i18n.site.memory,
          type: 'range',
          min: 16,
          max: ctrl.ceval.engines.active().maxHash ?? 256,
          step: 16,
          value: info.hashSize,
          format: value => value + ' MB',
          change: value => {
            ctrl.ceval.setHashSize(Number(value));
            restart();
          },
        },
      ]);
      for (const [label, action] of [
        [i18n.site.showThreat, () => ctrl.toggleThreatMode()],
        [
          i18n.site.goDeeper,
          () => {
            ctrl.ceval.goDeeper();
            ctrl.redraw();
          },
        ],
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button-empty';
        button.textContent = label;
        button.addEventListener('click', action);
        settings.append(button);
      }
      this.engine.querySelector('.xiangqi-engine-settings')!.replaceWith(settings);
    }
    const settings = this.engine.querySelector<HTMLElement>('.xiangqi-engine-settings')!;
    settings.hidden = !ctrl.ceval.showEnginePrefs();
    if (!settings.hidden) {
      const provider = this.provider?.elm as HTMLElement | undefined;
      const mount = provider ?? document.createElement('div');
      if (mount.parentElement !== settings) settings.prepend(mount);
      this.provider = patch(
        this.provider ?? mount,
        hl('div.xiangqi-engine-settings__provider', [engineSelection(ctrl)]),
      );
    }
    this.engine.querySelector<HTMLInputElement>('input')!.checked = !!ctrl.cevalEnabled();
    this.engine.querySelector('button')!.setAttribute('aria-expanded', String(ctrl.ceval.showEnginePrefs()));
    const allowed = ctrl.isCevalAllowed() && ctrl.allowedEval();
    const score = allowed || undefined;
    const evaluation = ctrl.cevalEnabled()
      ? ctrl.threatMode()
        ? ctrl.node.threat
        : ctrl.node.ceval
      : undefined;
    if (!score) this.suggestions.resetEvaluation();
    this.suggestions.setEvaluation(score ? { redCp: score.cp, redMate: score.mate } : undefined);
    if (
      ctrl.isCevalAllowed() &&
      evaluation &&
      !ctrl.study?.hideMoves() &&
      !ctrl.practice &&
      !ctrl.retro?.isSolving()
    ) {
      this.suggestions.renderEngine(
        {
          engine: ctrl.ceval.engines.active().name,
          depth: evaluation.depth,
          nodes: evaluation.nodes ?? 0,
          nps: 0,
          timeMs: 'millis' in evaluation ? (evaluation.millis ?? 0) : 0,
          score: { redCp: evaluation.cp, redMate: evaluation.mate },
          lines: evaluation.pvs.map((pv, index) => ({
            multipv: index + 1,
            depth: evaluation.depth,
            seldepth: evaluation.depth,
            score: { redCp: pv.cp, redMate: pv.mate },
            pvMoves: pv.moves,
            wxfMoves: [],
          })),
        },
        moves => ctrl.playUciList(moves),
      );
    } else {
      this.suggestions.clearResults();
      this.suggestions.showPlaceholders();
      this.elements.engineStatus.textContent = ctrl.ceval.isComputing
        ? i18n.site.calculatingMoves
        : i18n.site.inLocalBrowser;
    }
    const search = ctrl.ceval.search.by;
    const download = ctrl.ceval.download;
    const percent = download
      ? download.total
        ? (download.bytes / download.total) * 100
        : undefined
      : ctrl.ceval.state === CevalState.Loading
        ? undefined
        : !ctrl.ceval.isComputing && evaluation
          ? 100
          : 'movetime' in search
            ? (100 * (evaluation && 'millis' in evaluation ? (evaluation.millis ?? 0) : 0)) / search.movetime
            : 'depth' in search
              ? (100 * (evaluation?.depth ?? 0)) / search.depth
              : (100 * (evaluation?.nodes ?? 0)) / search.nodes;
    updateProgressBar(this.engine.querySelector<HTMLElement>('.bar')!, {
      visible: !!ctrl.cevalEnabled() || !!download,
      active: ctrl.ceval.isComputing || ctrl.ceval.state === CevalState.Loading,
      label: ctrl.ceval.state === CevalState.Loading ? i18n.site.loadingEngine : i18n.site.calculatingMoves,
      percent,
      threat: ctrl.threatMode(),
    });
    if (ctrl.ceval.state === CevalState.Failed)
      this.elements.engineStatus.textContent = i18n.site.engineLoadingFailed;
    else if (ctrl.ceval.state === CevalState.Loading)
      this.elements.engineStatus.textContent = i18n.site.loadingEngine;
    this.engine.querySelector<HTMLElement>('.xiangqi-engine__name')!.textContent =
      ctrl.ceval.engines.active().name;
  }

  destroy(): void {
    this.suggestions.destroy();
    if (this.provider) {
      const empty = patch(this.provider, hl('div'));
      (empty.elm as HTMLElement).remove();
      this.provider = undefined;
    }
  }
}

const views = new WeakMap<AnalyseCtrl, StudyEngineView>();
function view(ctrl: AnalyseCtrl): StudyEngineView {
  let result = views.get(ctrl);
  if (!result) {
    result = new StudyEngineView(ctrl);
    views.set(ctrl, result);
  }
  return result;
}

function release(ctrl: AnalyseCtrl): void {
  const shared = views.get(ctrl);
  if (shared && --shared.mounts === 0) {
    shared.destroy();
    views.delete(ctrl);
  }
}

export function renderXiangqiEngine(ctrl: AnalyseCtrl): VNode[] {
  const update = (vnode: VNode) => {
    const shared = view(ctrl);
    if (shared.engine.parentElement !== vnode.elm) (vnode.elm as HTMLElement).append(shared.engine);
    shared.update();
  };
  return [
    hl('div.analyse__engine', {
      hook: {
        insert: vnode => {
          view(ctrl).mounts++;
          update(vnode);
        },
        postpatch: (_old, vnode) => update(vnode),
        destroy: () => release(ctrl),
      },
    }),
  ];
}

export function renderXiangqiGauge(ctrl: AnalyseCtrl): VNode {
  const update = (vnode: VNode) => {
    const shared = view(ctrl);
    shared.gauge.classList.add('eval-gauge');
    if (vnode.elm !== shared.gauge) (vnode.elm as HTMLElement).replaceWith(shared.gauge);
    vnode.elm = shared.gauge;
    shared.update();
  };
  return hl('div.eval-gauge.xiangqi-eval', {
    hook: {
      insert: vnode => {
        view(ctrl).mounts++;
        update(vnode);
      },
      postpatch: (_old, vnode) => update(vnode),
      destroy: () => release(ctrl),
    },
  });
}
