import { completeNode } from 'lib/tree/node';
import { structuredCloneLite } from 'lib/tree/ops';
import type { TreeNode } from 'lib/tree/types';

import { ANALYSIS_TABS_STORAGE_KEY, MAX_ANALYSIS_TABS, type AnalysisTab } from './analysisTabs';

/** A replay owns its drafts, even when its starting position matches another game. */
export function analysisWorkspaceKey(replay?: AnalysisTab): string {
  return replay?.gameId
    ? `lixiangqi.analysis.replay.v1.${encodeURIComponent(replay.gameId)}.${encodeURIComponent(
        replay.tree.root.ruleset ?? '',
      )}.${encodeURIComponent(replay.initialFen)}`
    : ANALYSIS_TABS_STORAGE_KEY;
}

/** Keep the recorded game authoritative; restore only compatible local analysis additions. */
export function restoreReplayWorkspace(
  saved: AnalysisTab[],
  replay: AnalysisTab,
  explicitPly: boolean,
): { tabs: AnalysisTab[]; activeId: string } {
  const matching = saved.find(
    tab =>
      tab.kind === 'game' &&
      tab.gameId === replay.gameId &&
      tab.initialFen === replay.initialFen &&
      tab.tree.root.ruleset === replay.tree.root.ruleset,
  );
  if (matching) {
    mergeReplayEdits(replay.tree.root, matching.tree.root);
    // Rebuild paths and derived state without replacing the tree captured by server analysis.
    completeNode(replay.tree.root);
    replay.id = matching.id;
    replay.title = matching.title;
    if (!explicitPly && replay.tree.pathExists(matching.activePath)) replay.activePath = matching.activePath;
    return { tabs: saved.map(tab => (tab === matching ? replay : tab)), activeId: replay.id };
  }
  if (saved.length >= MAX_ANALYSIS_TABS)
    throw new Error('Close an analysis tab before restoring this game; saved replay drafts were preserved');
  return { tabs: [...saved, replay], activeId: replay.id };
}

function mergeReplayEdits(recorded: TreeNode, saved: TreeNode): void {
  if (recorded.fen !== saved.fen || recorded.ply !== saved.ply)
    throw new Error('Saved replay positions differ from this game; saved replay drafts were preserved');
  recorded.comments = saved.comments;
  recorded.glyphs = saved.glyphs;
  recorded.shapes = saved.shapes;
  recorded.collapsed = saved.collapsed;
  recorded.evaluation ??= saved.evaluation;
  for (const child of saved.children) {
    const existing = recorded.children.find(node => node.id === child.id);
    if (existing) mergeReplayEdits(existing, child);
    else recorded.children.push(completeNode(structuredCloneLite(child), recorded.path));
  }
}
