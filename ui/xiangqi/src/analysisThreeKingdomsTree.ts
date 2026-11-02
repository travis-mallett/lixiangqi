import {
  Tree,
  moveNotation,
  nextTurnSlot,
  turnOrder,
  notationElement,
  notationLabel,
  type MoveNotation,
  type TurnSlot,
  type Color,
  type Rules,
  type State,
} from 'threeKingdoms';

import type { AnalysisNode, AnalysisTree, AnalysisTreeViewOptions } from './analysisTreeView';

export interface KingdomNode extends AnalysisNode {
  index: number;
  actor: Color;
  display: MoveNotation;
  slot?: TurnSlot;
  event: boolean;
  children: KingdomNode[];
}

const displays = new WeakMap<
  Tree['nodes'][number],
  { rules: Rules; before: State; action: string; actor: Color; display: MoveNotation }
>();

/** Navigation rebuilds the view model, but recorded positions and actions are unchanged.
 * Keep expensive rules formatting with its source node; discarded trees remain collectible.
 */
function displayMove(source: Tree, index: number): MoveNotation {
  const node = source.nodes[index];
  const before = source.nodes[node.parent].state;
  const cached = displays.get(node);
  if (
    cached?.rules === source.rules &&
    cached.before === before &&
    cached.action === node.action &&
    cached.actor === node.actor
  )
    return cached.display;
  const display = moveNotation(source.rules, before, node.action, node.actor);
  displays.set(node, { rules: source.rules, before, action: node.action, actor: node.actor, display });
  return display;
}

/** Adapts actor-tagged events to the shared variation UI without fabricating two-player rules states. */
export class KingdomAnalysisTree implements AnalysisTree<KingdomNode> {
  readonly root: KingdomNode;
  private readonly paths = new Map<string, KingdomNode>();
  private nodes: KingdomNode[];

  constructor(readonly source: Tree) {
    this.nodes = source.nodes.map((node, index) => ({
      id: index ? String(index) : '',
      path: '',
      index,
      actor: node.actor,
      display: index ? displayMove(source, index) : { text: '', actor: node.actor },
      event: !node.action.includes('>'),
      ply: 0,
      uci: node.action,
      comments: node.comment ? [{ id: String(index), by: { kind: 'unknown' }, text: node.comment }] : [],
      children: [],
      collapsed: node.collapsed,
      forceVariation: node.forceVariation,
    }));
    this.root = this.nodes[0];
    this.nodes.forEach((node, index) => {
      if (index) {
        const parent = this.nodes[source.nodes[index].parent];
        node.ply = parent.ply + 1;
        node.slot = node.event ? parent.slot : nextTurnSlot(parent.slot, node.actor);
        node.notation = node.display.text;
        node.path = parent.path ? `${parent.path}/${node.id}` : node.id;
        parent.children.push(node);
      }
      this.paths.set(node.path, node);
    });
  }
  nodeAtPath(path: string): KingdomNode {
    const node = this.paths.get(path);
    if (!node) throw new Error('Invalid variation');
    return node;
  }
  pathExists(path: string): boolean {
    return this.paths.has(path);
  }
  parentNode(path: string): KingdomNode {
    return this.nodeAtPath(path.split('/').slice(0, -1).join('/'));
  }
  pathIsMainline(path: string): boolean {
    if (!path) return true;
    const parent = this.parentNode(path);
    return parent.children[0]?.path === path && this.pathIsMainline(parent.path);
  }
  pathIsForcedVariation(path: string): boolean {
    return (
      !!path &&
      (!!this.nodeAtPath(path).forceVariation || this.pathIsForcedVariation(this.parentNode(path).path))
    );
  }
  promoteAt(path: string, mainline: boolean): void {
    let node = this.nodeAtPath(path);
    while (node.path) {
      const parent = this.parentNode(node.path);
      parent.children = [node, ...parent.children.filter(child => child !== node)];
      node.forceVariation = false;
      if (!mainline) break;
      node = parent;
    }
    this.flush();
  }
  forceVariationAt(path: string, force: boolean): void {
    this.nodeAtPath(path).forceVariation = force;
    this.flush();
  }
  deleteNodeAt(path: string): void {
    const parent = this.parentNode(path);
    parent.children = parent.children.filter(child => child.path !== path);
    this.flush();
  }
  flush(): void {
    const old = this.source.nodes.slice();
    const current = old[this.source.cursor];
    const result: typeof old = [];
    const ordered: KingdomNode[] = [];
    const visit = (node: KingdomNode, parent: number) => {
      const original = old[node.index];
      const index = result.length;
      node.index = index;
      ordered.push(node);
      result.push({ ...original, parent, collapsed: node.collapsed, forceVariation: node.forceVariation });
      if (original === current) this.source.cursor = index;
      node.children.forEach(child => visit(child, index));
    };
    this.source.cursor = 0;
    visit(this.root, -1);
    this.source.nodes.splice(0, this.source.nodes.length, ...result);
    this.nodes = ordered;
    this.paths.clear();
    ordered.forEach(node => this.paths.set(node.path, node));
  }
  pathFor(index: number): string {
    return this.nodes[index]?.path ?? '';
  }
}

/** The same actor and army presentation is used on desktop and mobile. */
export function kingdomTreePresentation(): Pick<
  AnalysisTreeViewOptions<KingdomNode>,
  | 'playerColumns'
  | 'notation'
  | 'notationElement'
  | 'moveTitle'
  | 'moveMeta'
  | 'isEvent'
  | 'branchLabel'
  | 'continuationLabel'
> {
  return {
    playerColumns: turnOrder.map(key => ({
      key,
      className: `kingdom-color--${key}`,
      label: { red: i18n.threeKingdoms.shu, green: i18n.threeKingdoms.wu, black: i18n.threeKingdoms.wei }[
        key
      ],
      title: i18n.threeKingdoms[key],
    })),
    notation: (node: KingdomNode) => node.display.text,
    notationElement: (node: KingdomNode) => notationElement(node.display),
    moveTitle: (node: KingdomNode) => notationLabel(node.display),
    moveMeta: (node: KingdomNode) => ({ mover: node.actor, number: node.slot?.round ?? 1 }),
    isEvent: (node: KingdomNode) => node.event,
    branchLabel: (number: number, player: string) => i18n.threeKingdoms.alternativeAt(String(number), player),
    continuationLabel: (mainline: boolean) =>
      mainline ? i18n.threeKingdoms.mainLine : i18n.threeKingdoms.continueVariation,
  };
}
