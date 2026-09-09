import { deserializeMoveTree, serializeMoveTree, type XiangqiMoveTree } from './tree';

const PREFIX = '#analysis=';

/** Carry an explicit analysis tree in the fragment so it never enters server request logs. */
export function createAnalysisUrl(tree: XiangqiMoveTree, orientation: 'white' | 'black'): string {
  return `/analysis${PREFIX}${encodeURIComponent(
    JSON.stringify({ orientation, draft: serializeMoveTree(tree, tree.root.state.fen, '') }),
  )}`;
}

export function readAnalysisUrl(
  hash: string,
  chinese = false,
): { tree: XiangqiMoveTree; initialFen: string; orientation: 'white' | 'black' } | undefined {
  if (!hash.startsWith(PREFIX)) return undefined;
  const payload = JSON.parse(decodeURIComponent(hash.slice(PREFIX.length)));
  if (
    !payload ||
    (payload.orientation !== 'white' && payload.orientation !== 'black') ||
    typeof payload.draft?.initialFen !== 'string'
  )
    throw new Error('Invalid analysis link');
  const initialFen: string = payload.draft.initialFen;
  const { tree } = deserializeMoveTree(payload.draft, initialFen, chinese);
  if (tree.root.state.fen !== initialFen) throw new Error('Invalid analysis starting position');
  return { tree, initialFen, orientation: payload.orientation };
}
