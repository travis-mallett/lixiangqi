// The only tree path codec: an ordered sequence of native coordinate moves.
import type { TreeNodeBase, TreeNodeId, TreePath } from './types';

const move = /^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$/;
export const root: TreePath = '';

export function ids(path: TreePath): TreeNodeId[] {
  if (!path) return [];
  const result = path.split('/');
  if (result.some(id => !move.test(id))) throw new Error(`Invalid Xiangqi tree path: ${path}`);
  return result;
}
export function join(parts: readonly TreeNodeId[]): TreePath {
  if (parts.some(id => !move.test(id))) throw new Error('Invalid Xiangqi move identity');
  return parts.join('/');
}
export const append = (path: TreePath, id: TreeNodeId): TreePath => join([...ids(path), id]);
export const concat = (first: TreePath, second: TreePath): TreePath => join([...ids(first), ...ids(second)]);
export const size = (path: TreePath): number => ids(path).length;
export const head = (path: TreePath): TreeNodeId => ids(path)[0] ?? '';
export const tail = (path: TreePath): TreePath => join(ids(path).slice(1));
export const init = (path: TreePath): TreePath => join(ids(path).slice(0, -1));
export const last = (path: TreePath): TreeNodeId => ids(path).slice(-1)[0] ?? '';
export const take = (path: TreePath, count: number): TreePath => join(ids(path).slice(0, count));
export const drop = (path: TreePath, count: number): TreePath => join(ids(path).slice(count));
export const contains = (path: TreePath, ancestor: TreePath): boolean => {
  const descendants = ids(path);
  return ids(ancestor).every((id, index) => descendants[index] === id);
};
export const fromNodeList = (nodes: readonly TreeNodeBase[]): TreePath =>
  join(nodes.flatMap(node => (node.id ? [node.id] : [])));
export const isChildOf = (child: TreePath, parent: TreePath): boolean => !!child && init(child) === parent;
export const intersection = (first: TreePath, second: TreePath): TreePath => {
  const left = ids(first),
    right = ids(second);
  let count = 0;
  while (count < left.length && left[count] === right[count]) count++;
  return join(left.slice(0, count));
};
