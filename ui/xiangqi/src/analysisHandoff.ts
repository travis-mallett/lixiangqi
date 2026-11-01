import { randomId } from 'lib/algo';
import {
  deserializeMoveTree,
  getNodeList,
  mainlineEndPath,
  serializeMoveTree,
  type XiangqiMoveTree,
} from 'lib/tree/native';

const PREFIX = '#analysis=';

/** Native replay links carry the selected absolute ply, including custom starting positions. */
export function replayPath(tree: XiangqiMoveTree, hash: string): string {
  const end = mainlineEndPath(tree);
  if (!/^#\d+$/.test(hash)) return end;
  const ply = Number(hash.slice(1));
  return getNodeList(tree, end).find(node => node.state.ply === ply)?.path ?? end;
}

/** Carry an explicit analysis tree in the fragment so it never enters server request logs. */
export function createAnalysisUrl(
  tree: XiangqiMoveTree,
  orientation: 'red' | 'black',
  activePath = '',
): string {
  return `/analysis${PREFIX}${encodeURIComponent(
    JSON.stringify({
      id: randomId(),
      orientation,
      draft: serializeMoveTree(tree, tree.root.state.fen, activePath),
    }),
  )}`;
}

export function readAnalysisUrl(hash: string):
  | {
      id: string;
      tree: XiangqiMoveTree;
      initialFen: string;
      orientation: 'red' | 'black';
      activePath: string;
    }
  | undefined {
  if (!hash.startsWith(PREFIX)) return undefined;
  const payload = JSON.parse(decodeURIComponent(hash.slice(PREFIX.length)));
  if (
    !payload ||
    (payload.orientation !== 'red' && payload.orientation !== 'black') ||
    typeof payload.draft?.initialFen !== 'string'
  )
    throw new Error('Invalid analysis link');
  const id = payload.id === undefined ? legacyHandoffId(hash) : payload.id;
  if (typeof id !== 'string' || !/^[0-9a-z-]{3,80}$/i.test(id)) throw new Error('Invalid analysis link');
  const initialFen: string = payload.draft.initialFen;
  const { tree, activePath } = deserializeMoveTree(payload.draft, initialFen);
  if (tree.root.state.fen !== initialFen) throw new Error('Invalid analysis starting position');
  return { id, tree, initialFen, orientation: payload.orientation, activePath };
}

function legacyHandoffId(value: string): string {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `handoff-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
