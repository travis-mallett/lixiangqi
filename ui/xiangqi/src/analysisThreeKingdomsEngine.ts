import { boardPresentation, type BoardView } from '@lixiangqi/board';
import {
  balanceShares,
  position,
  el,
  button,
  type EngineResult,
  type Rules,
  type State,
  type SearchOptions,
} from 'threeKingdoms';

import { createXiangqiBoard } from 'lib/board';
import { updateProgressBar } from 'lib/view/progressBar';

import { bindEngineSettings, createAnalysisEngineView, createAnalysisSettings } from './analysisEngineView';
import { loadEngineSettings, engineSettingsKey, type EngineSettings } from './analysisSettings';
import { balanceLabels } from './analysisThreeKingdomsEvaluation';

/** Three-player engine adapter; the panel, settings, progress, and PV vocabulary are shared. */
export class KingdomEngineView {
  readonly element: HTMLElement = createAnalysisEngineView();
  readonly lineButton: HTMLButtonElement = button(i18n.threeKingdoms.analyseLine, () =>
    this.actions.analyseLine(),
  );
  readonly settings: EngineSettings = loadEngineSettings('threeKingdoms');
  private readonly status = this.element.querySelector<HTMLElement>('.xiangqi-analysis__substatus')!;
  private readonly lines = this.element.querySelector<HTMLElement>('.xiangqi-engine__lines')!;
  private readonly toggle = this.element.querySelector<HTMLInputElement>('input')!;
  private preview?: BoardView;
  private last?: { state: State; result: EngineResult; final: boolean };
  previewMove?: string;

  constructor(
    private readonly rules: Rules,
    private readonly actions: {
      changed: (search: boolean) => void;
      analyseLine: () => void;
      play: (moves: string[]) => void;
      arrows: () => void;
      perspective: () => string;
    },
  ) {
    const name = i18n.site.threeKingdoms;
    this.element.classList.add('kingdom-engine');
    this.element.setAttribute('aria-label', i18n.site.engineAnalysisName(name));
    this.element.querySelector('.xiangqi-engine__name')!.textContent = i18n.site.engineOnDevice(name);
    this.element.querySelector<HTMLElement>('.xiangqi-engine__headline-score')!.hidden = true;
    this.toggle.addEventListener('change', () => actions.changed(true));
    const persist = (search: boolean) => {
      localStorage.setItem(engineSettingsKey('threeKingdoms'), JSON.stringify(this.settings));
      actions.changed(search);
    };
    const panel = createAnalysisSettings([
      {
        name: 'lines-preview',
        label: i18n.threeKingdoms.linesPreview,
        type: 'checkbox',
        value: this.settings.showLinesPreview,
        change: value => {
          this.settings.showLinesPreview = !!value;
          this.hidePreview();
          persist(false);
        },
      },
      {
        name: 'depth',
        label: i18n.threeKingdoms.searchDepth,
        type: 'range',
        min: 1,
        max: 6,
        value: this.settings.depth,
        change: value => {
          this.settings.depth = Number(value);
          persist(true);
        },
      },
      {
        name: 'arrow-updates',
        label: i18n.site.arrowUpdates,
        type: 'range',
        min: 1,
        max: 4,
        value: this.settings.arrowUpdates,
        change: value => {
          this.settings.arrowUpdates = Number(value);
          persist(false);
        },
      },
      {
        name: 'multipv',
        label: i18n.site.multipleLines,
        type: 'range',
        min: 1,
        max: 5,
        value: this.settings.multiPv,
        format: value => `${value} / 5`,
        change: value => {
          this.settings.multiPv = Number(value);
          persist(true);
        },
      },
    ]);
    panel.prepend(el('p', 'xiangqi-engine__help', i18n.threeKingdoms.searchHelp));
    this.lineButton.id = 'xiangqi-analyse-line';
    this.lineButton.className = 'button button-empty';
    panel.append(this.lineButton);
    this.element.querySelector('.xiangqi-engine-settings')!.replaceWith(panel);
    const settingsButton = this.element.querySelector<HTMLButtonElement>('.xiangqi-icon-button')!;
    settingsButton.title = settingsButton.ariaLabel = i18n.site.engineSettingsName(name);
    bindEngineSettings(settingsButton, panel);
    this.lines.setAttribute('aria-label', i18n.site.multipleLines);
    this.lines.addEventListener('mouseleave', () => this.hidePreview());
    this.lines.addEventListener('focusout', event => {
      if (!this.lines.contains(event.relatedTarget as Node)) this.hidePreview();
    });
  }

  get enabled(): boolean {
    return this.toggle.checked;
  }

  search(): SearchOptions {
    return {
      depth: this.settings.depth,
      nodes: [500, 3000, 12000, 30000, 60000, 100000][this.settings.depth - 1],
      multiPv: this.settings.multiPv,
    };
  }

  clear(): void {
    this.last = undefined;
    this.hidePreview();
    this.lines.replaceChildren();
    this.progress(false, 0);
    this.status.textContent = '';
  }

  thinking(): void {
    this.status.textContent = i18n.threeKingdoms.engineThinking;
    this.progress(true, 0);
    for (let i = 0; i < this.settings.multiPv; i++) this.lines.append(el('div', 'pv placeholder', '…'));
  }

  progress(active: boolean, depth: number, final = false): void {
    this.element.classList.toggle('computing', active);
    updateProgressBar(this.element.querySelector('.bar')!, {
      active,
      visible: this.enabled || active,
      percent: final ? 100 : (100 * depth) / this.settings.depth,
      label: i18n.site.depthX(depth),
    });
  }

  render(state: State, result: EngineResult, final: boolean): void {
    this.last = { state, result, final };
    this.hidePreview();
    this.status.textContent =
      i18n.threeKingdoms.depth(result.depth, result.nodes) +
      (final ? ` · ${i18n.site.engineSearchComplete}` : '');
    this.progress(!final, result.depth, final);
    this.lines.replaceChildren();
    result.lines.forEach((line, rank) => {
      if (!line.pvMoves.length) return;
      const row = el('div', 'pv kingdom-engine__pv');
      const heading = el('div', 'kingdom-engine__pv-heading');
      heading.append(el('strong', '', String(rank + 1)), balanceLabels(balanceShares(line), undefined, true));
      const moves = el('div', 'kingdom-engine__moves');
      let current = state;
      line.pvMoves.forEach((move, ply) => {
        const before = current;
        current = rulesState(this.rules, before, move);
        const after = current;
        const control = button(this.rules.notation(before.position, move), () =>
          this.actions.play(line.pvMoves.slice(0, ply + 1)),
        );
        control.className = `pv-move kingdom-color--${before.turn}`;
        control.title = i18n.threeKingdoms[before.turn];
        const preview = () => {
          this.hidePreview();
          this.previewMove = line.pvMoves[0];
          this.actions.arrows();
          if (!this.settings.showLinesPreview || window.matchMedia('(max-width: 799px)').matches) return;
          const mount = el('div', 'pv-board');
          const board = el('div');
          mount.append(board);
          this.lines.append(mount);
          this.preview = createXiangqiBoard(
            board,
            position(after),
            boardPresentation('preview', this.actions.perspective()),
          );
        };
        control.addEventListener('mouseenter', preview);
        control.addEventListener('focus', preview);
        moves.append(control);
      });
      row.append(heading, moves);
      this.lines.append(row);
    });
  }

  refresh(): void {
    if (this.last) this.render(this.last.state, this.last.result, this.last.final);
  }

  error(retry: () => void): void {
    this.clear();
    this.status.textContent = i18n.threeKingdoms.engineUnavailable;
    this.lines.append(button(i18n.threeKingdoms.retry, retry));
  }

  hidePreview(): void {
    this.preview?.destroy();
    this.preview = undefined;
    this.lines.querySelector('.pv-board')?.remove();
    if (this.previewMove) {
      this.previewMove = undefined;
      this.actions.arrows();
    }
  }
}

function rulesState(rules: Rules, before: State, move: string): State {
  return rules.inspect(rules.play(before.position, move));
}
