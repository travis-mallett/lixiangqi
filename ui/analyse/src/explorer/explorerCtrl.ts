import { ExplorerCtrl as NativeExplorer, type ExplorerData } from '@lixiangqi/explorer';

import { prop } from 'lib';
import { requestXiangqi } from 'lib/game/xiangqiApi';
import { storedBooleanProp } from 'lib/storage';

import type AnalyseCtrl from '@/ctrl';

import type { ExplorerOpts } from './interfaces';

/** Study owns permissions and insertion; the shared explorer owns database requests and presentation. */
export default class ExplorerCtrl {
  readonly allowed = prop(true);
  readonly enabled = storedBooleanProp('analyse.explorer.enabled', false);
  readonly hovering = prop<{ fen: string; uci: string } | null>(null);
  private view?: NativeExplorer;
  constructor(
    readonly root: AnalyseCtrl,
    readonly opts: ExplorerOpts,
    previous?: ExplorerCtrl,
  ) {
    if (previous) this.allowed(previous.allowed());
  }
  mount(element: HTMLElement): void {
    this.destroy();
    this.view = new NativeExplorer(
      element,
      document.createElement('button'),
      this.root.explorerMove,
      game => window.open(`/analysis?game=${encodeURIComponent(game.id)}`, '_blank', 'noopener'),
      this.opts.endpoint,
      {
        initiallyEnabled: this.enabled(),
        persistPreferences: !this.root.isEmbed,
        onHover: uci => this.setHovering(this.root.node.fen, uci ?? null),
        gameActions: game =>
          this.root.study?.isWriting()
            ? [
                { label: i18n.study.insertChapter, run: () => this.root.study!.explorerGame(game.id, false) },
                { label: i18n.study.insertLine, run: () => this.root.study!.explorerGame(game.id, true) },
              ]
            : [],
      },
    );
    this.setNode();
  }
  destroy = (): void => {
    this.view?.destroy();
    this.view = undefined;
  };
  setNode = (): void => {
    if (!this.view) return;
    if (this.view.enabled !== this.enabled()) this.view.toggle();
    this.view.setPosition({
      fen: this.root.node.fen,
      initialFen: this.root.tree.root.fen,
      moves: this.root.nodeList.slice(1).map(node => node.uci!),
      ruleset: this.root.tree.root.ruleset!,
    });
  };
  toggle = (): void => {
    this.enabled(!this.enabled() && this.allowed());
    this.setNode();
    this.root.redraw();
  };
  disable = (): void => {
    this.enabled(false);
    this.setNode();
  };
  onFlip = (): void => {
    this.setNode();
  };
  setHovering = (fen: string, uci: string | null): void => {
    this.hovering(uci ? { fen, uci } : null);
    this.root.fork.hover(uci);
    this.root.setAutoShapes();
  };
  fetchMasterOpening = (fen: string): Promise<ExplorerData> =>
    requestXiangqi(`${this.opts.endpoint.replace(/\/$/, '')}/explorer`, { fen, database: 'masters' });
}
