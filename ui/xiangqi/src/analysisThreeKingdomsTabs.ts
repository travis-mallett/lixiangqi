import { Tree, type Rules } from 'threeKingdoms';

import { randomId } from 'lib/algo';

import { MAX_ANALYSIS_TABS, normalizeAnalysisTabTitle } from './analysisTabs';

export interface KingdomTab {
  id: string;
  title: string;
  kind: 'analysis' | 'game';
  gameId?: string;
  tree: Tree;
}
export const kingdomTabsKey = 'threeKingdoms.analysis.tabs.v1';
const oldDraftKey = 'threeKingdoms.analysis.v1';
export const newKingdomTab = (tree: Tree, gameId?: string): KingdomTab => ({
  id: randomId(),
  title: i18n.site.threeKingdoms,
  kind: gameId ? 'game' : 'analysis',
  ...(gameId ? { gameId } : {}),
  tree,
});

function sameImportedGame(left: Tree, source: Tree): boolean {
  if (source.nodes.length < 2 || left.initial !== source.initial || left.nodes.length !== source.nodes.length)
    return false;
  return left.nodes.every(
    (node, index) =>
      node.parent === source.nodes[index].parent &&
      node.action === source.nodes[index].action &&
      node.actor === source.nodes[index].actor,
  );
}

export function findKingdomGameTab(
  tabs: KingdomTab[],
  gameId: string,
  gameTree: Tree,
): KingdomTab | undefined {
  return (
    tabs.find(tab => tab.kind === 'game' && tab.gameId === gameId) ??
    tabs.find(tab => !tab.gameId && sameImportedGame(tab.tree, gameTree))
  );
}

export function saveKingdomTabs(tabs: KingdomTab[], activeId: string): void {
  localStorage.setItem(
    kingdomTabsKey,
    JSON.stringify({
      activeId,
      tabs: tabs.map(({ id, title, kind, gameId, tree }) => ({
        id,
        title,
        kind,
        ...(gameId ? { gameId } : {}),
        record: tree.export(),
      })),
    }),
  );
}

export function loadKingdomTabs(rules: Rules): { tabs: KingdomTab[]; activeId: string } {
  const saved = localStorage.getItem(kingdomTabsKey);
  if (saved) {
    const stored = JSON.parse(saved);
    if (!Array.isArray(stored.tabs) || !stored.tabs.length || stored.tabs.length > MAX_ANALYSIS_TABS)
      throw new Error('Invalid saved analysis tabs');
    const tabs: KingdomTab[] = stored.tabs.map((tab: KingdomTab & { record: unknown }) => {
      if (
        !tab ||
        typeof tab.id !== 'string' ||
        !tab.id ||
        typeof tab.title !== 'string' ||
        !normalizeAnalysisTabTitle(tab.title) ||
        !['analysis', 'game'].includes(tab.kind) ||
        (tab.gameId !== undefined && typeof tab.gameId !== 'string')
      )
        throw new Error('Invalid saved analysis tab');
      return {
        id: tab.id,
        title: tab.title,
        kind: tab.kind,
        ...(tab.gameId ? { gameId: tab.gameId } : {}),
        tree: Tree.import(rules, JSON.stringify(tab.record)),
      };
    });
    if (
      new Set(tabs.map(tab => tab.id)).size !== tabs.length ||
      !tabs.some(tab => tab.id === stored.activeId)
    )
      throw new Error('Invalid analysis selection');
    return { tabs, activeId: stored.activeId };
  }
  const old = localStorage.getItem(oldDraftKey);
  const tab = newKingdomTab(old ? Tree.import(rules, old) : new Tree(rules, rules.initial()));
  if (old) {
    // Keep the exact original draft recoverable before migrating to tab storage.
    localStorage.setItem(oldDraftKey + '.backup', old);
    saveKingdomTabs([tab], tab.id);
    localStorage.removeItem(oldDraftKey);
  }
  return { tabs: [tab], activeId: tab.id };
}
