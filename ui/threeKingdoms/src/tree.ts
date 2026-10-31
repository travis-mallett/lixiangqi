import type { BoardMark } from '@lixiangqi/board';

import { validEvaluation, type Evaluation } from './evaluation';
import type { Color, RecordedAction, Rules, State } from './types';

export interface Node {
  parent: number;
  action: string;
  actor: Color;
  comment: string;
  marks: readonly BoardMark[];
  state: State;
  collapsed?: boolean;
  forceVariation?: boolean;
  evaluation?: Evaluation;
}
export interface AnalysisRecord {
  format: 'LiXiangQi Three Kingdoms analysis';
  formatVersion: 1;
  rules: 'threeKingdoms-v1';
  initial: string;
  nodes: Omit<Node, 'state'>[];
  cursor: number;
}

export class Tree {
  readonly nodes: Node[];
  cursor = 0;
  constructor(
    readonly rules: Rules,
    readonly initial: string,
  ) {
    this.nodes = [
      {
        parent: -1,
        action: '',
        actor: rules.inspect(initial).turn,
        comment: '',
        marks: [],
        state: rules.inspect(initial),
      },
    ];
  }
  get current(): Node {
    return this.nodes[this.cursor];
  }
  children(index: number = this.cursor): number[] {
    return this.nodes.flatMap((node, i) => (node.parent === index ? [i] : []));
  }
  play(action: string, actor: Color = this.current.state.turn): void {
    const existing = this.children().find(
      i => this.nodes[i].action === action && this.nodes[i].actor === actor,
    );
    if (existing !== undefined) {
      this.cursor = existing;
      return;
    }
    if (this.nodes.length >= 1501) throw new Error('Analysis is full');
    const state = this.rules.inspect(this.rules.event(this.current.state.position, actor, action));
    this.nodes.push({ parent: this.cursor, action, actor, state, comment: '', marks: [] });
    this.cursor = this.nodes.length - 1;
  }
  line(index: number = this.cursor): number[] {
    const line: number[] = [];
    while (index > 0) {
      line.unshift(index);
      index = this.nodes[index].parent;
    }
    return line;
  }
  last(): number {
    let index = this.cursor;
    while (this.children(index).length) index = this.children(index)[0];
    return index;
  }
  export(): AnalysisRecord {
    return {
      format: 'LiXiangQi Three Kingdoms analysis',
      formatVersion: 1,
      rules: 'threeKingdoms-v1',
      initial: this.initial,
      nodes: this.nodes.map(
        ({ parent, action, actor, comment, marks, collapsed, forceVariation, evaluation }) => ({
          parent,
          action,
          actor,
          comment,
          marks,
          collapsed,
          forceVariation,
          evaluation,
        }),
      ),
      cursor: this.cursor,
    };
  }
  static fromEvents(rules: Rules, initial: string, events: RecordedAction[]): Tree {
    if (events.length > 1500) throw new Error('Too many moves');
    const tree = new Tree(rules, initial);
    for (const event of events) tree.play(event.action, event.actor);
    return tree;
  }
  static import(rules: Rules, value: string): Tree {
    if (value.length > 2_000_000) throw new Error('Record is too large');
    const record = JSON.parse(value);
    if (record.rules !== 'threeKingdoms-v1') throw new Error('Unsupported rules');
    if (Array.isArray(record.events)) return Tree.fromEvents(rules, record.initial, record.events);
    if (
      record.format !== 'LiXiangQi Three Kingdoms analysis' ||
      record.formatVersion !== 1 ||
      !Array.isArray(record.nodes) ||
      !record.nodes.length ||
      record.nodes.length > 1501
    )
      throw new Error('Invalid analysis record');
    const tree = new Tree(rules, record.initial);
    for (let i = 0; i < record.nodes.length; i++) {
      const node = record.nodes[i] as Omit<Node, 'state'>;
      if (!node || typeof node.action !== 'string' || !['red', 'black', 'green'].includes(node.actor))
        throw new Error('Invalid action');
      if (i === 0 && (node.parent !== -1 || node.action !== '' || node.actor !== tree.current.state.turn))
        throw new Error('Invalid root');
      if (i > 0) {
        if (!Number.isInteger(node.parent) || node.parent < 0 || node.parent >= i)
          throw new Error('Invalid variation parent');
        tree.cursor = node.parent;
        tree.play(node.action, node.actor);
        if (tree.cursor !== i) throw new Error('Duplicate variation');
      }
      if (
        typeof node.comment !== 'string' ||
        node.comment.length > 10000 ||
        !Array.isArray(node.marks) ||
        node.marks.length > 100
      )
        throw new Error('Invalid annotations');
      tree.nodes[i].comment = node.comment;
      if (node.evaluation !== undefined) {
        if (!validEvaluation(node.evaluation)) throw new Error('Invalid evaluation');
        tree.nodes[i].evaluation = { shares: [...node.evaluation.shares], depth: node.evaluation.depth };
      }
      tree.nodes[i].collapsed = typeof node.collapsed === 'boolean' ? node.collapsed : undefined;
      tree.nodes[i].forceVariation =
        typeof node.forceVariation === 'boolean' ? node.forceVariation : undefined;
      // SVG supplied by imported records is never trusted or rendered.
      tree.nodes[i].marks = node.marks.map(mark => ({
        from: String(mark.from),
        to: mark.to ? String(mark.to) : undefined,
        brush: ['green', 'red', 'blue', 'yellow'].includes(mark.brush ?? '') ? mark.brush : 'green',
      }));
    }
    tree.cursor =
      Number.isInteger(record.cursor) && record.cursor >= 0 && record.cursor < tree.nodes.length
        ? record.cursor
        : 0;
    return tree;
  }
}
