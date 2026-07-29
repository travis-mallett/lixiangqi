import { deserializeMoveTree, serializeMoveTree, type StoredMoveTree, type XiangqiMoveTree } from './tree';

export const ANALYSIS_TABS_STORAGE_KEY = 'lixiangqi.analysis.tabs.v1';
export const MAX_ANALYSIS_TABS = 12;
export const MAX_ANALYSIS_TAB_TITLE_LENGTH = 120;

export interface AnalysisTab {
  id: string;
  title: string;
  kind: 'analysis' | 'game';
  gameId?: string;
  initialFen: string;
  tree: XiangqiMoveTree;
  activePath: string;
}

interface StoredAnalysisTab {
  id: string;
  title: string;
  kind: AnalysisTab['kind'];
  gameId?: string;
  draft: StoredMoveTree;
}

interface StoredAnalysisTabs {
  version: 1;
  activeId: string;
  tabs: StoredAnalysisTab[];
}

export function serializeAnalysisTabs(tabs: AnalysisTab[], activeId: string): StoredAnalysisTabs {
  return {
    version: 1,
    activeId,
    tabs: tabs.map(tab => ({
      id: tab.id,
      title: tab.title,
      kind: tab.kind,
      ...(tab.gameId ? { gameId: tab.gameId } : {}),
      draft: serializeMoveTree(tab.tree, tab.initialFen, tab.activePath),
    })),
  };
}

export function normalizeAnalysisTabTitle(value: string): string | undefined {
  const title = value.trim();
  return title && title.length <= MAX_ANALYSIS_TAB_TITLE_LENGTH ? title : undefined;
}

export function deserializeAnalysisTabs(
  value: unknown,
  chinese = false,
): {
  tabs: AnalysisTab[];
  activeId: string;
} {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tabs) || !value.tabs.length)
    throw new Error('Saved analysis tabs have an incompatible format');
  if (value.tabs.length > MAX_ANALYSIS_TABS) throw new Error('Too many saved analysis tabs');

  const ids = new Set<string>();
  const tabs = value.tabs.map(stored => {
    const title =
      isRecord(stored) && typeof stored.title === 'string'
        ? normalizeAnalysisTabTitle(stored.title)
        : undefined;
    if (
      !isRecord(stored) ||
      typeof stored.id !== 'string' ||
      !/^[0-9a-z-]{3,80}$/i.test(stored.id) ||
      ids.has(stored.id) ||
      !title ||
      (stored.kind !== 'analysis' && stored.kind !== 'game') ||
      !isRecord(stored.draft) ||
      typeof stored.draft.initialFen !== 'string'
    )
      throw new Error('Saved analysis tabs contain an invalid tab');
    ids.add(stored.id);
    const restored = deserializeMoveTree(stored.draft, stored.draft.initialFen, chinese);
    return {
      id: stored.id,
      title,
      kind: stored.kind,
      ...(typeof stored.gameId === 'string' ? { gameId: stored.gameId } : {}),
      initialFen: stored.draft.initialFen,
      tree: restored.tree,
      activePath: restored.activePath,
    } satisfies AnalysisTab;
  });
  const activeId =
    typeof value.activeId === 'string' && ids.has(value.activeId) ? value.activeId : tabs[0].id;
  return { tabs, activeId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
