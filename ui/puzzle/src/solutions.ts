export interface PuzzlePlayback {
  objective: 'mate' | 'tactic';
  startingCp?: number;
  solutions: string[][];
}

export interface SolutionNode {
  children: Map<string, SolutionNode>;
  complete: boolean;
  remaining: number;
}

// Prefixes, rather than board positions, preserve the rules history of each line.
export class PuzzleSolutions {
  readonly root: SolutionNode = { children: new Map(), complete: false, remaining: Infinity };

  constructor(lines: string[][]) {
    lines.forEach(line => this.add(line));
  }

  add(line: string[]): void {
    let node = this.root;
    for (let ply = 0; ply <= line.length; ply++) {
      node.remaining = Math.min(
        node.remaining,
        Math.floor((line.length - ply + (ply % 2 === 0 ? 1 : 0)) / 2),
      );
      if (ply === line.length) {
        node.complete = true;
        break;
      }
      let child = node.children.get(line[ply]);
      if (!child) {
        child = { children: new Map(), complete: false, remaining: Infinity };
        node.children.set(line[ply], child);
      }
      node = child;
    }
  }

  at(played: string[]): SolutionNode | undefined {
    let node: SolutionNode | undefined = this.root;
    for (const move of played) node = node?.children.get(move);
    return node;
  }

  next(played: string[]): string | undefined {
    return this.at(played)?.children.keys().next().value;
  }
}

export const defenderDelay = (animation: number): number => Math.max(750, animation + 100);
