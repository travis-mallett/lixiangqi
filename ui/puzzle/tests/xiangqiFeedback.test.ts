import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { VNode } from 'snabbdom';

import type PuzzleCtrl from '../src/ctrl.ts';
import { makeXiangqiNode } from '../src/xiangqi.ts';
import { isEfficientMate, type WinningContinuation } from '../src/xiangqiAdjudication.ts';

mock.module('lib/permalog', { namedExports: { log: () => Promise.resolve() } });
const { default: feedback } = await import('../src/view/feedback.ts');

const solution = ['a1a2', 'e10d10', 'a2a3', 'd10e10', 'a3a4'];
const continuation = (moves: string[]): WinningContinuation => ({
  moves,
  finalState: {} as WinningContinuation['finalState'],
});

for (const player of ['red', 'black'] as const) {
  const sign = player === 'red' ? 1 : -1;
  test(`${player}: equally short and faster mating alternatives are best moves, slower ones are not`, () => {
    const played = ['a1a5'];
    const equal = continuation(['e10d10', 'a5a6', 'd10e10', 'a6a7']);
    const faster = continuation(['e10d10', 'a5a6']);
    const slower = continuation([...equal.moves, 'e10d10', 'a7a8']);
    assert.equal(isEfficientMate(solution, played, equal, { redMate: 2 * sign }, player), true);
    assert.equal(isEfficientMate(solution, played, faster, { redMate: sign }, player), true);
    assert.equal(isEfficientMate(solution, played, slower, { redMate: 3 * sign }, player), false);
    assert.equal(isEfficientMate(solution, played, slower, { redMate: 2 * sign }, player), false);
    assert.equal(isEfficientMate(solution, played, equal, { redMate: -2 * sign }, player), false);
    assert.equal(isEfficientMate(solution, played, equal, { redCp: 1000 * sign }, player), false);
  });
}

test('mate efficiency uses the accepted local continuation after an earlier detour', () => {
  const accepted = ['a1a5', 'e10d10', 'a5a6', 'd10e10', 'a6a7', 'e10d10', 'a7a8'];
  const played = ['a1a5', 'e10d10', 'a5a9'];
  const winning = continuation(['d10e10', 'a9a7', 'e10d10', 'a7a8']);
  assert.equal(isEfficientMate(accepted, played, winning, { redMate: 2 }, 'red'), true);
  assert.equal(isEfficientMate(solution, played, winning, { redMate: 2 }, 'red'), false);
});

Object.assign(globalThis, {
  i18n: {
    site: {
      yourTurn: 'Your turn',
      getAHint: 'Get a Hint',
      viewTheSolution: 'View the Solution',
      retry: 'Retry',
    },
    puzzle: {
      findTheBestMoveForWhite: 'Find the best move for red.',
      thisIsTheBestMove: 'This is the best move',
      notMostEfficientMove: 'Not the most efficient move',
      keepGoing: 'Keep going.',
      continuationAllowed: 'But continuation allowed.',
      advantageLost: 'Advantage Lost',
      tryAgain: 'Try again',
      moveAllowanceExceeded: 'Move allowance exceeded',
      trySomethingElse: 'Try something else.',
      puzzleSuccess: 'Success!',
      puzzleComplete: 'Puzzle complete!',
      continueTraining: 'Continue training',
    },
  },
});

function controller(overrides: Partial<PuzzleCtrl> = {}): PuzzleCtrl {
  return {
    isXiangqi: true,
    mode: 'play',
    lastFeedback: 'init',
    pov: 'white',
    canViewSolution: () => true,
    showHint: () => false,
    moveAllowanceExceeded: () => false,
    toggleHint() {},
    viewSolution() {},
    retryPuzzle() {},
    ...overrides,
  } as PuzzleCtrl;
}

function visibleText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const vnode = node as VNode;
  return [vnode.text, ...(vnode.children ?? []).map(visibleText)].filter(Boolean).join(' ');
}

test('evaluation keeps initial, accepted, and failed feedback unchanged', () => {
  for (const lastFeedback of ['init', 'good', 'fail'] as const) {
    const ctrl = controller({ lastFeedback, xiangqiBestMove: true, xiangqiFailure: 'advantageLost' });
    const before = visibleText(feedback(ctrl));
    Object.assign(ctrl, { xiangqiEvaluating: true });
    assert.equal(visibleText(feedback(ctrl)), before);
    assert.ok(!before.includes('Pikafish'));
  }
});

test('accepted best moves and permitted deviations have distinct feedback', () => {
  const best = visibleText(feedback(controller({ lastFeedback: 'good', xiangqiBestMove: true })));
  assert.match(best, /This is the best move Keep going\./);
  assert.ok(!best.includes('Not the most efficient'));
  const allowed = visibleText(feedback(controller({ lastFeedback: 'good', xiangqiBestMove: false })));
  assert.match(allowed, /Not the most efficient move But continuation allowed\./);
  assert.ok(!allowed.includes('Keep going'));
});

test('move exhaustion offers Retry and View Solution without a hint or another-move encouragement', () => {
  const text = visibleText(
    feedback(
      controller({
        lastFeedback: 'fail',
        xiangqiFailure: 'moveAllowanceExceeded',
        moveAllowanceExceeded: () => true,
      }),
    ),
  );
  assert.match(text, /Move allowance exceeded Retry View the Solution/);
  assert.ok(!text.includes('Get a Hint'));
  assert.ok(!text.includes('Try something else'));
});

test('lost advantage encourages trying again', () => {
  assert.match(
    visibleText(feedback(controller({ lastFeedback: 'fail', xiangqiFailure: 'advantageLost' }))),
    /Advantage Lost Try again/,
  );
});

test('completion displays performance statistics only for a solved puzzle', () => {
  const ctrl = controller({
    mode: 'view',
    lastFeedback: 'win',
    data: {} as PuzzleCtrl['data'],
    node: { fen: 'position' } as PuzzleCtrl['node'],
    initialNode: makeXiangqiNode(
      { fen: 'position', ply: 0, turn: 'red', legalMoves: [], check: false, gameResult: '*' },
      '',
      '',
      0,
    ),
    nextPuzzle() {},
    solvedMessage: () => 'Puzzle solved in 5 moves. Most efficient solution: 2 moves.',
  });
  const solved = visibleText(feedback(ctrl));
  assert.match(solved, /Puzzle solved in 5 moves\. Most efficient solution: 2 moves\./);
  assert.ok(!solved.includes('Success!'));
  ctrl.lastFeedback = 'fail';
  const revealed = visibleText(feedback(ctrl));
  assert.match(revealed, /Puzzle complete!/);
  assert.ok(!revealed.includes('Puzzle solved'));
});
