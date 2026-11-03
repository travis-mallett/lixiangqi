import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  JIEQI_START_FEN,
  jieqiObservation,
  jieqiEngineFen,
  revealChoices,
  randomReveal,
} from '../src/game/jieqi';
import type { RulesState } from '../src/game/xiangqiNotation';
import { createMoveTree, addOrSelectChild, serializeMoveTree, deserializeMoveTree } from '../src/tree/native';

const initial: RulesState = {
  variant: 'jieqi',
  fen: JIEQI_START_FEN,
  ply: 0,
  turn: 'red',
  check: false,
  legalMoves: ['a4a5', 'b3b10'],
  gameResult: '*',
  captures: [],
};

test('unknown captures remain in the information set; known captures reduce only their role', () => {
  const hidden = { side: 'black' as const, square: 'b10', concealed: true, ply: 1 };
  const publicState = { ...initial, fen: initial.fen.replace('xxxxkxxxx', 'x1xxkxxxx'), captures: [hidden] };
  assert.deepEqual(jieqiObservation(publicState).remaining, jieqiObservation(initial).remaining);
  const known = [{ ...hidden, role: 'horse' }];
  const observed = jieqiObservation({ ...publicState, captures: known });
  assert.equal(observed.remaining.n, 1);
  assert.equal(observed.remaining.r, 2);
  assert.equal(jieqiEngineFen(observed).split(' ')[2], 'R2A2C2P5N2B2r2a2c2p5n1b2');
  assert.equal(JSON.stringify(publicState).includes('horse'), false);
});

test('analysis offers only remaining piece types and distinct reveals survive serialization', () => {
  assert.deepEqual(
    new Set(revealChoices(initial, 'a4a5').map(choice => choice.role)),
    new Set(['chariot', 'horse', 'elephant', 'advisor', 'cannon', 'soldier']),
  );
  const tree = createMoveTree(initial);
  const outcomes = ['horse', 'chariot'].map(reveal =>
    addOrSelectChild(tree, '', {
      uci: 'a4a5',
      notation: 'P9+1',
      chineseNotation: '兵九进一',
      state: { ...initial, ply: 1, turn: 'black', reveal },
    }),
  );
  assert.notEqual(outcomes[0].path, outcomes[1].path);
  const restored = deserializeMoveTree(
    JSON.parse(JSON.stringify(serializeMoveTree(tree, initial.fen, outcomes[1].path))),
    initial.fen,
  );
  assert.equal(restored.tree.root.children.length, 2);
  assert.deepEqual(restored.tree.positionAt(outcomes[1].path), {
    initialFen: initial.fen,
    moves: ['a4a5'],
    ruleset: 'jieqi-v1',
    reveals: ['chariot'],
    knownCaptures: {},
  });
});

test('reveal probabilities use remaining identities for the moving side', () => {
  const choices = revealChoices(initial, 'a4a5');
  assert.equal(choices.find(c => c.role === 'soldier')?.probability, 5 / 15);
  assert.equal(choices.find(c => c.role === 'advisor')?.probability, 2 / 15);
  const state: RulesState = {
    ...initial,
    fen: initial.fen.replace('XXXXKXXXX', 'RXXXKXXXX'),
    captures: [
      { side: 'red', square: 'b1', concealed: false, role: 'chariot', ply: 1 },
      { side: 'red', square: 'c1', concealed: true, ply: 2 },
      { side: 'black', square: 'a10', concealed: false, role: 'advisor', ply: 3 },
    ],
  };
  const remaining = revealChoices(state, 'a4a5');
  assert.ok(!remaining.some(c => c.role === 'chariot'));
  assert.equal(remaining.find(c => c.role === 'advisor')?.probability, 2 / 13);
  assert.equal(remaining.find(c => c.role === 'soldier')?.probability, 5 / 13);
  const black = revealChoices({ ...state, turn: 'black' }, 'a7a6');
  assert.equal(black.find(c => c.role === 'advisor')?.probability, 1 / 14);
  assert.deepEqual(revealChoices(state, 'a1a2'), []);
});

test('random reveal weights every remaining piece equally, including interval boundaries', () => {
  const choices = revealChoices(initial, 'a4a5');
  const counts = new Map<string | undefined, number>();
  for (let i = 0; i < 15; i++) {
    const role = randomReveal(choices, () => (i + 0.5) / 15);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  for (const choice of choices) assert.equal(counts.get(choice.role), choice.count);
  assert.equal(
    randomReveal(choices, () => 0),
    choices[0].role,
  );
  assert.equal(
    randomReveal(choices, () => choices[0].count / 15),
    choices[1].role,
  );
  assert.equal(
    randomReveal(choices, () => 1 - Number.EPSILON),
    choices.at(-1)?.role,
  );
  assert.equal(
    randomReveal([], () => 0),
    undefined,
  );
  assert.equal(randomReveal([{ role: 'advisor', count: 1, probability: 1 }]), 'advisor');
});

test('concealed captures offer the captured side inventory and retain distinct branches', () => {
  const state = {
    ...initial,
    captures: [{ side: 'black' as const, square: 'a10', role: 'horse', concealed: true, ply: 0 }],
  };
  const choices = revealChoices(state, 'b3b10', true);
  assert.equal(choices.find(c => c.role === 'horse')?.probability, 1 / 14);
  assert.equal(choices.find(c => c.role === 'soldier')?.probability, 5 / 14);
  assert.deepEqual(revealChoices(initial, 'a4a5', true), []);
  const tree = createMoveTree(initial);
  const paths = ['horse', 'chariot'].map(
    role =>
      addOrSelectChild(tree, '', {
        uci: 'b3b10',
        notation: 'C8+7',
        state: {
          ...initial,
          ply: 1,
          reveal: 'soldier',
          captures: [{ side: 'black', square: 'b10', role, concealed: true, ply: 1 }],
        },
      }).path,
  );
  assert.notEqual(paths[0], paths[1]);
  const restored = deserializeMoveTree(
    JSON.parse(JSON.stringify(serializeMoveTree(tree, initial.fen, paths[1]))),
    initial.fen,
  );
  assert.equal(restored.tree.root.children.length, 2);
  assert.deepEqual(restored.tree.positionAt(paths[1]).knownCaptures, { b10: 'chariot' });
});

test('existing saved capture branches preserve their selected position when opened', () => {
  const tree = createMoveTree(initial);
  const added = addOrSelectChild(tree, '', {
    uci: 'b3b10',
    notation: 'C8+7',
    state: {
      ...initial,
      ply: 1,
      reveal: 'soldier',
      captures: [{ side: 'black', square: 'b10', role: 'horse', concealed: true, ply: 1 }],
    },
  });
  const stored = serializeMoveTree(tree, initial.fen, added.path);
  stored.root.children[0].id = 'b3b10~soldier';
  stored.activePath = 'b3b10~soldier';
  const restored = deserializeMoveTree(stored, initial.fen);
  assert.equal(restored.activePath, added.path);
  assert.deepEqual(restored.tree.positionAt(restored.activePath).knownCaptures, { b10: 'horse' });
});
