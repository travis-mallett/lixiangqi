import {
  deserializeMoveTree,
  serializeMoveTree,
  type StoredMoveTree,
  type XiangqiMoveTree,
} from 'lib/tree/native';

export const ANALYSIS_TABS_STORAGE_KEY = 'lixiangqi.analysis.tabs.v2';
export const MAX_ANALYSIS_TABS = 12;
export const MAX_ANALYSIS_TAB_TITLE_LENGTH = 120;

// Pending imports belong to a tab, but are not part of its saved move tree.
export interface AnalysisEditorState {
  fen?: string;
  notation?: string;
  fenError?: string;
  notationError?: string;
}

export interface AnalysisTab {
  id: string;
  title: string;
  kind: 'analysis' | 'game';
  gameId?: string;
  initialFen: string;
  tree: XiangqiMoveTree;
  activePath: string;
  editor?: AnalysisEditorState;
}

interface StoredAnalysisTab {
  id: string;
  title: string;
  kind: AnalysisTab['kind'];
  gameId?: string;
  draft: StoredMoveTree;
}

interface StoredAnalysisTabs {
  version: 2;
  activeId: string;
  tabs: StoredAnalysisTab[];
}

export function serializeAnalysisTabs(tabs: AnalysisTab[], activeId: string): StoredAnalysisTabs {
  return {
    version: 2,
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

export function mergeAnalysisHandoff(
  tabs: AnalysisTab[],
  activeId: string,
  handoff: AnalysisTab,
  legacyDraft?: AnalysisTab,
): { tabs: AnalysisTab[]; activeId: string; inserted: boolean } {
  const workspace = legacyDraft ? [...tabs, legacyDraft] : tabs;
  const existing = workspace.find(tab => tab.id === handoff.id);
  if (existing) return { tabs: workspace, activeId: existing.id, inserted: false };
  if (workspace.length >= MAX_ANALYSIS_TABS) return { tabs: workspace, activeId, inserted: false };
  return { tabs: [...workspace, handoff], activeId: handoff.id, inserted: true };
}

export function restoreAnalysisWorkspace(
  tabs: AnalysisTab[],
  activeId: string,
  currentFen: string,
  explicitFen: boolean,
  handoff?: AnalysisTab,
): { tabs: AnalysisTab[]; activeId: string } | undefined {
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0];
  if (!handoff && explicitFen && active.initialFen !== currentFen) return undefined;
  if (!handoff) return { tabs, activeId: active.id };
  const merged = mergeAnalysisHandoff(tabs, activeId, handoff);
  return { tabs: merged.tabs, activeId: merged.activeId };
}

export function deserializeAnalysisTabs(value: unknown): {
  tabs: AnalysisTab[];
  activeId: string;
} {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.tabs) || !value.tabs.length)
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
    const restored = deserializeMoveTree(stored.draft, stored.draft.initialFen);
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
