import { nodeAtPath, type RulesState, type XiangqiMoveTree } from './tree';

export interface XiangqiMoveSound {
  capture: boolean;
  check: boolean;
  mate: boolean;
}

export function xiangqiMoveSound(state?: RulesState): XiangqiMoveSound {
  return {
    capture: state?.capture === true,
    check: state?.check === true,
    mate: state?.checkmate === true || (state?.check === true && state.immediateEnd?.ended === true),
  };
}

export function xiangqiTransitionSound(
  tree: XiangqiMoveTree,
  fromPath: string,
  toPath: string,
): XiangqiMoveSound | undefined {
  if (fromPath === toPath || !tree.byPath.has(fromPath)) return undefined;
  const destination = nodeAtPath(tree, toPath);
  if (!destination) return undefined;
  return xiangqiMoveSound(destination === tree.root ? undefined : destination.state);
}

export function playXiangqiMoveSound(state: RulesState): void {
  site.sound.move(xiangqiMoveSound(state));
}

export function playXiangqiTransitionSound(tree: XiangqiMoveTree, fromPath: string, toPath: string): void {
  const sound = xiangqiTransitionSound(tree, fromPath, toPath);
  if (sound) site.sound.move(sound);
}
