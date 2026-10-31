import { Tree, type Color } from 'threeKingdoms';

import type { AnalysisNode, AnalysisTree } from './analysisTreeView';

export interface KingdomNode extends AnalysisNode {
  index: number;
  actor: Color;
  children: KingdomNode[];
}

/** Adapts actor-tagged events to the shared variation UI without fabricating two-player rules states. */
export class KingdomAnalysisTree implements AnalysisTree<KingdomNode> {
  readonly root: KingdomNode;
  private readonly paths = new Map<string, KingdomNode>();
  private readonly nodes: KingdomNode[];

  constructor(readonly source: Tree) {
    this.nodes = source.nodes.map((node, index) => ({
      id: index ? String(index) : '',
      path: '',
      index,
      actor: node.actor,
      ply: 0,
      uci: node.action,
      notation: node.action.includes('>')
        ? source.rules.notation(source.nodes[node.parent].state.position, node.action)
        : ((i18n.threeKingdoms as unknown as Record<string, string>)[node.action] ?? node.action),
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
    const visit = (node: KingdomNode, parent: number) => {
      const original = old[node.index];
      const index = result.length;
      node.index = index;
      result.push({ ...original, parent, collapsed: node.collapsed, forceVariation: node.forceVariation });
      if (original === current) this.source.cursor = index;
      node.children.forEach(child => visit(child, index));
    };
    this.source.cursor = 0;
    visit(this.root, -1);
    this.source.nodes.splice(0, this.source.nodes.length, ...result);
  }
  pathFor(index: number): string {
    return [...this.paths.values()].find(node => node.index === index)?.path ?? '';
  }
}
