import { wsConnect } from 'lib/socket';
import {
  applyServerAnalysis,
  getNodeList,
  mainlineEndPath,
  type ServerAnalysisInfo,
  type XiangqiMoveTree,
  type XiangqiPositionNode,
} from 'lib/tree/native';
import { mainlineNodeList } from 'lib/tree/ops';
import type { TreeNodeBase } from 'lib/tree/types';
import * as xhr from 'lib/xhr';

export interface ServerAnalysisBootstrap {
  gameId?: string;
  orientation?: 'red' | 'black';
  analysisInProgress?: boolean;
  analysisRequestUrl?: string;
  analysis?: { id: string; depth?: number | null };
}

interface Options {
  bootstrap: ServerAnalysisBootstrap;
  tree: () => XiangqiMoveTree;
  currentNode: () => XiangqiPositionNode;
  renderTree: () => void;
  renderEvaluation: (node: XiangqiPositionNode) => void;
  save: () => void;
  catalogPositions: (tree: XiangqiMoveTree, id: string) => Promise<XiangqiPositionNode[]>;
}

export function bindServerAnalysis(options: Options): {
  refresh: () => void;
  loadCatalog: (tree: XiangqiMoveTree, id: string) => Promise<void>;
} {
  const { bootstrap } = options;
  const panel = requiredElement('#xiangqi-server-analysis');
  const status = requiredElement('#xiangqi-server-analysis-status');
  const requestButton = requiredElement<HTMLButtonElement>('#xiangqi-request-analysis');
  const nativeTree = options.tree();
  const nativePositions = getNodeList(nativeTree, mainlineEndPath(nativeTree));
  let inProgress = bootstrap.analysisInProgress ?? false;
  const completed = new WeakMap<XiangqiMoveTree, number>();
  const catalogRequests = new WeakMap<XiangqiMoveTree, Promise<void>>();
  if (bootstrap.analysis) completed.set(nativeTree, bootstrap.analysis.depth ?? 0);

  const refresh = (): void => {
    const tree = options.tree();
    const depth = completed.get(tree);
    panel.hidden = depth === undefined && !(tree === nativeTree && bootstrap.gameId);
    requestButton.hidden =
      depth !== undefined || tree !== nativeTree || !bootstrap.analysisRequestUrl || inProgress;
    if (depth !== undefined)
      status.textContent = `${i18n.site.computerAnalysisAvailable}${depth ? ` · ${i18n.site.depthX(depth)}` : ''}`;
    else if (tree === nativeTree && inProgress)
      status.textContent = 'Full-game Pikafish analysis is in progress.';
    else status.textContent = i18n.site.requestAComputerAnalysis;
  };

  const render = (tree: XiangqiMoveTree): void => {
    if (options.tree() !== tree) return;
    refresh();
    options.renderTree();
    options.renderEvaluation(options.currentNode());
    options.save();
  };

  const apply = (tree: TreeNodeBase, depth = 0, complete = false): void => {
    if ((completed.get(nativeTree) ?? -1) > depth) return;
    inProgress = !complete;
    applyServerAnalysis(
      nativeTree,
      mainlineNodeList(tree).map(part => ({ ply: part.ply, ...part.eval, variation: [] })),
      depth,
      nativePositions,
    );
    if (complete) completed.set(nativeTree, depth);
    render(nativeTree);
  };

  if (
    bootstrap.gameId &&
    (bootstrap.analysis || bootstrap.analysisInProgress || bootstrap.analysisRequestUrl)
  ) {
    panel.hidden = false;
    if (bootstrap.analysis) {
      status.textContent = 'Full-game Pikafish analysis is complete.';
      requestButton.hidden = true;
    } else if (bootstrap.analysisInProgress) {
      status.textContent = 'Full-game Pikafish analysis is in progress.';
      requestButton.hidden = true;
    }

    wsConnect(
      `/watch/${bootstrap.gameId}/${bootstrap.orientation === 'black' ? 'black' : 'white'}/v6`,
      false,
      {
        receive(type: string, data: { tree?: TreeNodeBase; depth?: number; complete?: boolean }) {
          if (type === 'analysisProgress' && data.tree) apply(data.tree, data.depth ?? 0, data.complete);
        },
      },
    );
  }

  requestButton.addEventListener('click', () => {
    if (!bootstrap.analysisRequestUrl) return;
    requestButton.disabled = true;
    status.textContent = 'Submitting full-game Pikafish analysis…';
    void xhr
      .text(bootstrap.analysisRequestUrl, { method: 'post' })
      .then(() => {
        inProgress = true;
        requestButton.hidden = true;
        status.textContent = 'Full-game Pikafish analysis is in progress.';
      })
      .catch(error => {
        requestButton.disabled = false;
        status.textContent = error instanceof Error ? error.message : 'Could not request computer analysis.';
      });
  });

  refresh();
  return {
    refresh,
    loadCatalog(tree: XiangqiMoveTree, id: string): Promise<void> {
      const pending = catalogRequests.get(tree);
      if (pending) return pending;
      const request = xhr
        .json<{ analysis?: { infos: ServerAnalysisInfo[]; depth?: number } }>(
          `/api/analysis/catalog?id=${encodeURIComponent(id)}`,
        )
        .then(async ({ analysis }) => {
          if (analysis) {
            const recorded = await options.catalogPositions(tree, id);
            applyServerAnalysis(tree, analysis.infos, analysis.depth, recorded);
            completed.set(tree, analysis.depth ?? 0);
            render(tree);
          } else catalogRequests.delete(tree);
        })
        .catch(error => {
          catalogRequests.delete(tree);
          throw error;
        });
      catalogRequests.set(tree, request);
      return request;
    },
  };
}

function requiredElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Xiangqi analysis element: ${selector}`);
  return element;
}
