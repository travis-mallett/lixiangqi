import { XIANGQI_START_FEN } from 'lib/game/xiangqi';

import { fixtureTree } from './treeFixtures';

export function forcedVariationFixture() {
  const tree = fixtureTree(XIANGQI_START_FEN, ['a4a5', 'a7a6', 'c4c5']);
  const first = tree.root.children[0];
  const second = fixtureTree(XIANGQI_START_FEN, ['i4i5', 'i7i6']).root.children[0];
  const nested = fixtureTree(XIANGQI_START_FEN, ['a4a5', 'c7c6']).root.children[0].children[0];
  tree.root.children.push(second);
  first.children.push(nested);
  tree.root.metadata = { Result: '0-1', Event: 'Forced variation round trip' };
  tree.root.comments = [{ id: 'root', by: { kind: 'unknown' }, text: 'Root {literal}' }];
  first.forceVariation = second.forceVariation = nested.forceVariation = true;
  first.children[0].forceVariation = true;
  first.result = '1-0';
  first.children[0].result = '0-1';
  first.children[0].children[0].result = '1/2-1/2';
  nested.result = '*';
  second.result = '1/2-0';
  first.comments = [
    { id: 'move', by: { kind: 'external', name: 'Author' }, text: 'Keep [%nodeResult 0-0] as text' },
  ];
  first.clock = 1234;
  first.elapsed = 20;
  first.evaluation = { cp: 32, depth: 18 };
  first.glyphs = [{ id: 1, name: 'Good move', symbol: '!' }];
  first.shapes = [{ orig: 'a4', dest: 'a5', brush: 'red' }];
  first.gamebook = { hint: 'Choose a line', deviation: 'Try again' };
  first.comp = true;
  first.clockTrust = false;
  return tree;
}
