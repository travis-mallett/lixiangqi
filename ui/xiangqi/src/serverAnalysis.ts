import { wsConnect } from 'lib/socket';
import * as xhr from 'lib/xhr';

import { getNodeList, mainlineEndPath, type XiangqiMoveTree, type XiangqiPositionNode } from './tree';

export interface ServerAnalysisBootstrap {
  gameId?: string;
  orientation?: 'white' | 'black';
  analysisInProgress?: boolean;
  analysisRequestUrl?: string;
  analysis?: { id: string };
}

interface ServerTreePart {
  ply: number;
  eval?: {
    cp?: number;
    mate?: number;
    best?: string;
  };
}

interface Options {
  bootstrap: ServerAnalysisBootstrap;
  tree: () => XiangqiMoveTree;
  currentNode: () => XiangqiPositionNode;
  renderTree: () => void;
  renderEvaluation: (node: XiangqiPositionNode) => void;
  save: () => void;
}

export function bindServerAnalysis(options: Options): void {
  const { bootstrap } = options;
  const panel = requiredElement('#xiangqi-server-analysis');
  const status = requiredElement('#xiangqi-server-analysis-status');
  const requestButton = requiredElement<HTMLButtonElement>('#xiangqi-request-analysis');

  const apply = (parts: ServerTreePart[]): void => {
    const tree = options.tree();
    const nodesByPly = new Map(getNodeList(tree, mainlineEndPath(tree)).map(node => [node.state.ply, node]));
    for (const part of parts) {
      const node = nodesByPly.get(part.ply);
      if (!node || !part.eval) continue;
      node.evaluation = {
        engine: 'Pikafish server analysis',
        depth: 0,
        nodes: 0,
        score: {
          ...(part.eval.cp === undefined ? {} : { redCp: part.eval.cp }),
          ...(part.eval.mate === undefined ? {} : { redMate: part.eval.mate }),
        },
        ...(part.eval.best ? { best: part.eval.best } : {}),
      };
    }
    status.textContent = 'Full-game Pikafish analysis is complete.';
    requestButton.hidden = true;
    options.renderTree();
    options.renderEvaluation(options.currentNode());
    options.save();
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

    wsConnect(`/watch/${bootstrap.gameId}/${bootstrap.orientation ?? 'white'}/v6`, false, {
      receive(type: string, data: { treeParts?: ServerTreePart[] }) {
        if (type === 'analysisProgress' && data.treeParts) apply(data.treeParts);
      },
    });
  }

  requestButton.addEventListener('click', () => {
    if (!bootstrap.analysisRequestUrl) return;
    requestButton.disabled = true;
    status.textContent = 'Submitting full-game Pikafish analysis…';
    void xhr
      .text(bootstrap.analysisRequestUrl, { method: 'post' })
      .then(() => {
        requestButton.hidden = true;
        status.textContent = 'Full-game Pikafish analysis is in progress.';
      })
      .catch(error => {
        requestButton.disabled = false;
        status.textContent = error instanceof Error ? error.message : 'Could not request computer analysis.';
      });
  });
}

function requiredElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Xiangqi analysis element: ${selector}`);
  return element;
}
