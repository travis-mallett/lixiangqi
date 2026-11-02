import type { Tree } from 'threeKingdoms';

/** Deterministic, legal multi-round lines shared by DOM and browser layout checks. */
export function quietKingdomLine(tree: Tree, parent: number, length: number, seed = 0): number[] {
  tree.cursor = parent;
  const line: number[] = [];
  for (let ply = 0; ply < length; ply++) {
    const state = tree.current.state;
    const used = new Set(tree.children().map(index => tree.nodes[index].action));
    const occupied = new Set(state.pieces.map(piece => piece.location));
    const moves = state.moves.filter(move => !used.has(move) && !occupied.has(move.split('>')[1]));
    let selected: string | undefined;
    for (let attempt = 0; attempt < moves.length; attempt++) {
      const move = moves[(seed + ply * 7 + attempt) % moves.length];
      const next = tree.rules.inspect(tree.rules.play(state.position, move));
      if (!next.ending && next.active.length === state.active.length) {
        selected = move;
        break;
      }
    }
    if (!selected) throw new Error('No continuing quiet move in the variation fixture');
    tree.play(selected);
    line.push(tree.cursor);
  }
  return line;
}

export function kingdomVariationFixture(tree: Tree): {
  main: number[];
  branches: number[][];
  nested: number[];
} {
  const root = tree.cursor;
  const main = quietKingdomLine(tree, root, 18);
  const branches = [root, main[0], main[1]].map((parent, i) =>
    quietKingdomLine(tree, parent, [12, 20, 13][i], i * 3 + 1),
  );
  const nested = quietKingdomLine(tree, branches[1][0], 8, 13);
  quietKingdomLine(tree, branches[1][0], 6, 19);
  tree.nodes[branches[1][3]].comment = 'The continuation keeps the same player columns across rounds.';
  tree.nodes[nested[2]].comment = 'A nested alternative can also continue for several rounds.';
  tree.cursor = main[0];
  return { main, branches, nested };
}
