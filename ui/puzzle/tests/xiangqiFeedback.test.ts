import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { VNode } from 'snabbdom';

import type PuzzleCtrl from '../src/ctrl.ts';
import { evaluationPercent } from '../src/evaluationProgress.ts';
import { makeXiangqiNode } from '../src/xiangqi.ts';
import { isEfficientMate } from '../src/xiangqiAdjudication.ts';

mock.module('lib/permalog', { namedExports: { log: () => Promise.resolve() } });
const { default: feedback } = await import('../src/view/feedback.ts');

for (const player of ['red', 'black'] as const) {
  const sign = player === 'red' ? 1 : -1;
  test(`${player}: equally short and faster mating alternatives are best moves`, () => {
    assert.equal(isEfficientMate(2, { redMate: 2 * sign }, player), true);
    assert.equal(isEfficientMate(2, { redMate: sign }, player), true);
    assert.equal(isEfficientMate(2, { redMate: 3 * sign }, player), false);
    assert.equal(isEfficientMate(2, { redMate: -2 * sign }, player), false);
    assert.equal(isEfficientMate(2, { redCp: 1000 * sign }, player), false);
  });
}

Object.assign(globalThis, {
  i18n: {
    site: {
      yourTurn: 'Your turn',
      getAHint: 'Get a Hint',
      viewTheSolution: 'View the Solution',
      retry: 'Retry',
      loadingEngine: 'Loading engine...',
      startingEngine: 'Starting engine...',
      depthX: (depth: number) => `Depth ${depth}`,
      engineDownloadProgress: (percent: string, loaded: string, total: string) =>
        `Downloading engine: ${percent} (${loaded} / ${total} MB)`,
    },
    puzzle: {
      evaluatingMove: 'Evaluating Move',
      findTheBestMoveForWhite: 'Find the best move for red.',
      thisIsTheBestMove: 'This is the best move',
      tryAnotherMove: 'Try another move',
      keepGoing: 'Keep going.',
      continuationAllowed: 'Not the most efficient move, but continuation allowed.',
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
    engineStatus: { state: 'ready' },
    mode: 'play',
    lastFeedback: 'init',
    pov: 'white',
    data: { puzzle: { playback: { objective: 'mate' } } },
    failureMessage() {
      return i18n.puzzle[this.xiangqiFailure!];
    },
    showHint: () => false,
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

test('loading feedback replaces the turn prompt and exposes actual transferred size', () => {
  const ctrl = controller({ engineStatus: { state: 'downloading', bytes: 20_000_000, total: 50_000_000 } });
  const text = visibleText(feedback(ctrl));
  assert.match(text, /Loading engine.*Downloading engine: 40% \(20 \/ 50 MB\)/);
  assert.ok(!text.includes('Your turn'));
  ctrl.engineStatus = { state: 'initializing' };
  assert.match(visibleText(feedback(ctrl)), /Starting engine/);
});

test('deviation search replaces initial, accepted, and failed feedback with live depth', () => {
  for (const lastFeedback of ['init', 'good', 'fail'] as const) {
    const ctrl = controller({ lastFeedback, xiangqiBestMove: true, xiangqiFailure: 'advantageLost' });
    const before = visibleText(feedback(ctrl));
    Object.assign(ctrl, { xiangqiEvaluating: true, moveEvaluationDepth: 1 });
    assert.equal(visibleText(feedback(ctrl)), 'Evaluating Move Depth 1');
    ctrl.moveEvaluationDepth = 19;
    assert.equal(visibleText(feedback(ctrl)), 'Evaluating Move Depth 19');
    ctrl.moveEvaluationDepth = undefined;
    assert.equal(visibleText(feedback(ctrl)), before);
  }
});

test('measured search work reserves space for extensions without a depth limit', () => {
  assert.equal(evaluationPercent(0), 0);
  assert.ok(evaluationPercent(1) < 0.02);
  assert.equal(evaluationPercent(2_000), 37.5);
  assert.equal(evaluationPercent(4_000), 75);
  assert.equal(evaluationPercent(6_000), 85);
  assert.equal(evaluationPercent(15_000), 95);
  assert.equal(evaluationPercent(60_000), 95);
});

test('accepted best moves and permitted deviations have distinct feedback', () => {
  const best = visibleText(feedback(controller({ lastFeedback: 'good', xiangqiBestMove: true })));
  assert.match(best, /This is the best move Keep going\./);
  assert.ok(!best.includes('Not the most efficient'));
  const allowed = visibleText(feedback(controller({ lastFeedback: 'good', xiangqiBestMove: false })));
  assert.equal(allowed, '✓ Not the most efficient move, but continuation allowed.');
  assert.ok(!allowed.includes('This is the best move'));
});

test('move exhaustion stays succinct without a hint or redundant encouragement', () => {
  const text = visibleText(
    feedback(
      controller({
        lastFeedback: 'fail',
        xiangqiFailure: 'moveAllowanceExceeded',
      }),
    ),
  );
  assert.match(text, /Move allowance exceeded/);
  assert.ok(!text.includes('Get a Hint'));
  assert.ok(!text.includes('Try something else'));
});

test('lost advantage stays succinct', () => {
  assert.match(
    visibleText(feedback(controller({ lastFeedback: 'fail', xiangqiFailure: 'advantageLost' }))),
    /Advantage Lost/,
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
    solvedMessage: () => 'Puzzle solved in 5 moves. Reference solution: 2 moves.',
  });
  const solved = visibleText(feedback(ctrl));
  assert.match(solved, /Puzzle solved in 5 moves\. Reference solution: 2 moves\./);
  assert.ok(!solved.includes('Success!'));
  ctrl.lastFeedback = 'fail';
  const revealed = visibleText(feedback(ctrl));
  assert.match(revealed, /Puzzle complete!/);
  assert.ok(!revealed.includes('Puzzle solved'));
});
