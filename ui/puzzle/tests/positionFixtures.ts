import type { RulesState } from 'lib/game/xiangqiNotation';

import { fixtureTree } from '../../xiangqi/tests/treeFixtures.ts';
import type { PuzzleOpts } from '../src/interfaces.ts';

/** Explicit UI snapshots. These fixtures intentionally make no legality/adjudication claims. */
export function fixturePositions(fen: string, moves: string[]): RulesState[] {
  const tree = fixtureTree(fen, moves);
  return tree.getNodeList(moves.join('/')).map(node => node.state);
}

export function withPositions(options: PuzzleOpts): PuzzleOpts {
  const { game, puzzle } = options.data;
  game.ruleset = 'unrestricted-v1';
  game.notations = game.moves;
  game.states = fixturePositions(game.initialFen!, game.moves ?? []);
  game.states[game.states.length - 1] = puzzle.state!;
  puzzle.ruleset = game.ruleset;
  puzzle.solutionStates = fixturePositions(puzzle.state!.fen, puzzle.playback.solutions[0]);
  return options;
}
