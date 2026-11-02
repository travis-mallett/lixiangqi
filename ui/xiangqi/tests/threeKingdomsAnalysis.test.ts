import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Tree, type Rules } from 'threeKingdoms';

import { bindAnalysisKeyboard } from '../src/analysisKeyboard';
import {
  loadKingdomTabs,
  saveKingdomTabs,
  kingdomTabsKey,
  newKingdomTab,
  findKingdomGameTab,
} from '../src/analysisThreeKingdomsTabs';
import {
  KingdomAnalysisTree,
  kingdomTreePresentation,
  type KingdomNode,
} from '../src/analysisThreeKingdomsTree';
import { AnalysisTreeView } from '../src/analysisTreeView';
import { analysisVariantPicker } from '../src/analysisVariant';
import { kingdomVariationFixture, quietKingdomLine } from './threeKingdomsVariationFixture';

const rules: Rules = (
  await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href)
).ThreeKingdoms;

(globalThis as any).i18n = {
  site: {
    threeKingdoms: 'Game of the Three Kingdoms',
    variant: 'Variant',
    xiangqi: 'Xiangqi',
    jieqi: 'Jieqi',
    miniXiangqi: 'Mini Xiangqi',
  },
  threeKingdoms: {
    resign: 'Resign',
    red: 'Shu — red',
    green: 'Wu — green',
    black: 'Wei — black',
    shu: 'Shu',
    wu: 'Wu',
    wei: 'Wei',
    alternativeAt: (round: string, player: string) => `${round}. ${player} alternative`,
    mainLine: 'Main line',
    continueVariation: 'Continue variation',
  },
};

test('three columns keep green variations aligned and preserve annotations on desktop and mobile', () => {
  const source = new Tree(rules, rules.initial());
  source.play(source.current.state.moves[0]);
  const alternatives = source.current.state.moves.slice(0, 2);
  source.play(alternatives[0]);
  source.play(source.current.state.moves[0]);
  source.play(source.current.state.moves[0]);
  source.cursor = 1;
  source.play(alternatives[1]);
  source.current.comment = 'Green alternative';
  source.play(source.current.state.moves[0]);
  source.play(source.current.state.moves[0]);
  const model = new KingdomAnalysisTree(source);
  const mount = document.createElement('div');
  const view = new AnalysisTreeView<KingdomNode>({
    element: mount,
    tree: () => model,
    activePath: () => model.pathFor(source.cursor),
    setActivePath() {},
    navigate: path => {
      source.cursor = model.nodeAtPath(path).index;
    },
    commit() {},
    notationLayout: () => 'compact',
    ...kingdomTreePresentation(),
  });
  const oldMatch = window.matchMedia;
  try {
    for (const mobile of [false, true]) {
      window.matchMedia = (() => ({ matches: mobile })) as typeof window.matchMedia;
      view.render({ scrollToActive: false });
      assert.equal(mount.querySelectorAll('.analysis-column-tree__header > span').length, 4);
      assert.equal(mount.querySelectorAll('.xiangqi-analysis__horizontal-moves').length, 0);
      assert.equal(mount.querySelectorAll('.kingdom-piece').length, 7);
      assert.ok(mount.querySelector('.analysis-column-tree__row[aria-label="Main line"]'));
      const branch = mount.querySelector('.analysis-column-tree__branch.variation')!;
      assert.equal(branch.getAttribute('aria-label'), '1. Wu alternative');
      assert.doesNotMatch(branch.textContent, /1\. Wu alternative/);
      assert.match(branch.textContent, /Green alternative/);
      assert.equal(branch.querySelector<HTMLElement>('.green-move')!.style.gridColumn, '3');
      assert.equal(branch.querySelector<HTMLElement>('.red-move')!.parentElement!.dataset.round, '2');
      branch.querySelector<HTMLButtonElement>('button.green-move')!.click();
      assert.equal(source.cursor, 5);
    }
  } finally {
    window.matchMedia = oldMatch;
  }
});

test('long and nested variations retain every move, round, comment and collapse boundary', () => {
  const source = new Tree(rules, rules.initial());
  const fixture = kingdomVariationFixture(source);
  let deep = fixture.nested[0];
  for (let depth = 0; depth < 6; depth++) deep = quietKingdomLine(source, deep, 3, depth + 24)[0];
  const model = new KingdomAnalysisTree(source);
  const mount = document.createElement('div');
  const view = new AnalysisTreeView<KingdomNode>({
    element: mount,
    tree: () => model,
    activePath: () => model.pathFor(source.cursor),
    setActivePath() {},
    navigate: path => {
      source.cursor = model.nodeAtPath(path).index;
    },
    commit() {},
    notationLayout: () => 'compact',
    ...kingdomTreePresentation(),
  });
  view.render({ scrollToActive: false });
  const moves = mount.querySelectorAll<HTMLButtonElement>('button.xiangqi-analysis__move');
  assert.equal(moves.length, source.nodes.length - 1);
  for (const move of moves) {
    const node = model.nodeAtPath(move.dataset.path!);
    const row = move.closest<HTMLElement>('.analysis-column-tree__row')!;
    const cell = move.parentElement!.classList.contains('xiangqi-analysis__move-group')
      ? move.parentElement!
      : move;
    assert.equal(cell.style.gridColumn, String(node.slot!.column + 2));
    assert.equal(row.dataset.round, String(node.slot!.round));
  }
  const greenBranch = mount.querySelector('[aria-label="1. Wu alternative"]')!;
  assert.equal(greenBranch.querySelectorAll(':scope > .analysis-column-tree__row').length, 7);
  assert.match(greenBranch.textContent, /same player columns/);
  assert.match(greenBranch.textContent, /nested alternative/);
  assert.equal(
    mount.querySelectorAll(
      '.analysis-column-tree__origin, .analysis-column-tree__connector, .analysis-column-tree__resume',
    ).length,
    0,
  );
  const last = model.pathFor(fixture.branches[1].at(-1)!);
  mount.querySelector<HTMLButtonElement>(`[data-path="${last}"]`)!.click();
  assert.equal(source.cursor, fixture.branches[1].at(-1));
  model.nodeAtPath(model.pathFor(fixture.main[0])).collapsed = true;
  view.render({ scrollToActive: false });
  assert.equal(mount.querySelector(`[data-path="${last}"]`), null);
  assert.ok(mount.querySelector(`[data-path="${model.pathFor(fixture.main[1])}"]`));
});

test('indexed move paths stay correct after reordering and pruning a long variation', () => {
  const source = new Tree(rules, rules.initial());
  const fixture = kingdomVariationFixture(source);
  const model = new KingdomAnalysisTree(source);
  const promoted = model.pathFor(fixture.branches[1][0]);
  const removed = model.pathFor(fixture.branches[0][0]);
  model.promoteAt(promoted, true);
  model.deleteNodeAt(removed);
  assert.equal(model.pathExists(removed), false);
  source.nodes.forEach((node, index) => {
    const entry = model.nodeAtPath(model.pathFor(index));
    assert.equal(entry.index, index);
    assert.equal(entry.uci, node.action);
    assert.equal(entry.actor, node.actor);
  });
});

test('navigation reuses formatted moves while comments and changed positions stay current', () => {
  let formatted = 0;
  const countingRules = new Proxy(rules, {
    get(target, key) {
      if (key === 'notation')
        return (position: string, move: string) => {
          formatted++;
          return rules.notation(position, move);
        };
      return Reflect.get(target, key);
    },
  });
  const source = new Tree(countingRules, rules.initial());
  const line = quietKingdomLine(source, 0, 18);
  new KingdomAnalysisTree(source);
  assert.equal(formatted, 18);
  source.cursor = line.at(-1)!;
  source.current.comment = 'Updated annotation';
  const revisited = new KingdomAnalysisTree(source);
  assert.equal(formatted, 18, 'selecting another position does not reformat the record');
  assert.equal(
    revisited.nodeAtPath(revisited.pathFor(source.cursor)).comments?.[0].text,
    'Updated annotation',
  );
  source.nodes[0].state = rules.inspect(source.initial);
  new KingdomAnalysisTree(source);
  assert.equal(formatted, 19, 'a replaced source position invalidates its outgoing notation');
});

test('off-turn events do not consume or renumber a move slot', () => {
  const source = new Tree(rules, rules.initial());
  source.play(source.current.state.moves[0]);
  source.play('resign', 'black');
  source.play(source.current.state.moves[0]);
  source.play(source.current.state.moves[0]);
  const model = new KingdomAnalysisTree(source);
  assert.deepEqual(model.nodeAtPath(model.pathFor(3)).slot, { round: 1, column: 1 });
  assert.deepEqual(model.nodeAtPath(model.pathFor(4)).slot, { round: 2, column: 0 });
  assert.equal(model.nodeAtPath(model.pathFor(2)).event, true);
});

test('shared move tree promotes and deletes Three Kingdoms variations without losing actors or ownership', () => {
  const source = new Tree(rules, rules.initial());
  source.play('resign', 'green');
  const first = source.current.state.moves[0],
    second = source.current.state.moves[1];
  source.play(first);
  source.current.comment = 'First branch';
  source.cursor = 1;
  source.play(second);
  source.current.comment = 'Alternative';
  const position = source.current.state.position;
  const model = new KingdomAnalysisTree(source);
  const path = model.pathFor(source.cursor);
  model.promoteAt(path, true);
  assert.equal(source.current.state.position, position);
  assert.equal(source.nodes[2].comment, 'Alternative');
  assert.equal(Tree.import(rules, JSON.stringify(source.export())).current.state.position, position);
  const mount = document.createElement('div');
  document.body.append(mount);
  const current = new KingdomAnalysisTree(source);
  const view = new AnalysisTreeView<KingdomNode>({
    element: mount,
    tree: () => current,
    activePath: () => current.pathFor(source.cursor),
    setActivePath: path => {
      source.cursor = current.nodeAtPath(path).index;
    },
    navigate() {},
    commit: () => current.flush(),
    notationLayout: () => 'compact',
    notation: node => node.notation ?? '',
    moveMeta: node => ({ mover: node.actor, number: node.ply }),
  });
  view.render();
  assert.equal(mount.querySelectorAll('.xiangqi-analysis__move').length, 3);
  assert.ok(mount.querySelector('.green-move'));
  current.deleteNodeAt(current.root.children[0].children[1].path);
  assert.equal(source.nodes.length, 3);
  assert.deepEqual(source.current.state.controllers, ['black', null, 'red']);
  assert.equal(Tree.import(rules, JSON.stringify(source.export())).current.state.position, position);
  view.render();
  mount
    .querySelector<HTMLElement>(`[data-path="${current.pathFor(source.cursor)}"]`)!
    .dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
  const deletion = [...document.querySelectorAll<HTMLButtonElement>('.xiangqi-tree-menu button')].find(
    button => button.textContent?.startsWith('Delete'),
  );
  assert.ok(deletion);
  deletion.click();
  assert.equal(source.cursor, 1, 'deleting the selected branch returns to its parent');
  view.closeMenu();
  mount.remove();
});

test('shared keyboard navigation traverses three-player variations and leaves text inputs alone', () => {
  const source = new Tree(rules, rules.initial());
  const first = source.current.state.moves[0],
    second = source.current.state.moves[1];
  source.play(first);
  source.play(source.current.state.moves[0]);
  source.cursor = 0;
  source.play(second);
  const model = new KingdomAnalysisTree(source);
  let active = '';
  bindAnalysisKeyboard(
    () => model,
    () => active,
    path => {
      active = path;
    },
  );
  const key = (key: string, shiftKey = false) =>
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  key('ArrowRight');
  assert.equal(active, '1');
  key('ArrowRight', true);
  assert.equal(active, '3');
  key('ArrowLeft', true);
  assert.equal(active, '1');
  key('End');
  assert.equal(active, '1/2');
  const input = document.createElement('input');
  document.body.append(input);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(active, '1/2');
  key('Home');
  assert.equal(active, '');
  key('ArrowLeft');
  assert.equal(active, '');
  input.remove();
  window.dispatchEvent(new window.Event('pagehide'));
});

test('single draft migration backs up original data and all tabs round-trip independently', () => {
  localStorage.clear();
  const tree = new Tree(rules, rules.initial());
  tree.play('resign', 'black');
  const original = JSON.stringify(tree.export());
  localStorage.setItem('threeKingdoms.analysis.v1', original);
  const loaded = loadKingdomTabs(rules);
  assert.equal(localStorage.getItem('threeKingdoms.analysis.v1.backup'), original);
  assert.equal(localStorage.getItem('threeKingdoms.analysis.v1'), null);
  const second = newKingdomTab(new Tree(rules, rules.initial()));
  saveKingdomTabs([...loaded.tabs, second], second.id);
  const restored = loadKingdomTabs(rules);
  assert.equal(restored.tabs.length, 2);
  assert.equal(restored.activeId, second.id);
  assert.deepEqual(restored.tabs[0].tree.current.state.active, ['green', 'red']);
  assert.equal(restored.tabs[1].tree.nodes.length, 1);
  localStorage.clear();
});

test('invalid saved tabs fail without replacing the original data', () => {
  localStorage.clear();
  const invalid = JSON.stringify({ activeId: 'missing', tabs: [] });
  localStorage.setItem(kingdomTabsKey, invalid);
  assert.throws(() => loadKingdomTabs(rules), /Invalid saved/);
  assert.equal(localStorage.getItem(kingdomTabsKey), invalid);
  localStorage.clear();
});

test('the common analysis variant picker includes Three Kingdoms', () => {
  const panel = document.createElement('aside');
  panel.className = 'xiangqi-analysis-panel';
  document.body.append(panel);
  (globalThis as any).Option = window.Option;
  let selected: unknown;
  const select = analysisVariantPicker('xiangqi', variant => {
    selected = variant;
  });
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ['xiangqi', 'jieqi', 'minixiangqi', 'threeKingdoms'],
  );
  select.value = 'threeKingdoms';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(selected, 'threeKingdoms');
  panel.remove();
});

test('reloading a game analysis selects its existing tab instead of appending another', () => {
  const gameId = 'game-123';
  const events = [
    { actor: 'red', action: 'resign' },
    { actor: 'black', action: 'resign' },
  ] as const;
  const gameTree = Tree.fromEvents(rules, rules.initial(), [...events]);
  const saved = newKingdomTab(Tree.import(rules, JSON.stringify(gameTree.export())), gameId);
  assert.equal(findKingdomGameTab([saved], gameId, gameTree), saved);
  const legacyTree = Tree.import(rules, JSON.stringify(gameTree.export()));
  legacyTree.current.comment = 'Saved annotation';
  const legacy = newKingdomTab(legacyTree);
  assert.equal(findKingdomGameTab([legacy], gameId, gameTree), legacy);
  assert.equal(
    findKingdomGameTab([newKingdomTab(new Tree(rules, gameTree.initial))], gameId, gameTree),
    undefined,
    'an empty analysis is not mistaken for an imported game',
  );
  const prefixTree = Tree.fromEvents(rules, gameTree.initial, [events[0]]);
  assert.equal(
    findKingdomGameTab([newKingdomTab(prefixTree)], gameId, gameTree),
    undefined,
    'a saved prefix is not mistaken for the complete game replay',
  );
  const unrelatedTree = Tree.fromEvents(rules, gameTree.initial, [
    { actor: 'black', action: 'resign' },
    { actor: 'red', action: 'resign' },
  ]);
  assert.equal(
    findKingdomGameTab([newKingdomTab(unrelatedTree)], gameId, gameTree),
    undefined,
    'a different event sequence is not mistaken for the imported game',
  );
  assert.equal(
    findKingdomGameTab(
      [newKingdomTab(new Tree(rules, gameTree.initial))],
      gameId,
      new Tree(rules, gameTree.initial),
    ),
    undefined,
    'a move-less game cannot safely identify a legacy analysis tab',
  );
  localStorage.clear();
  saveKingdomTabs([saved], saved.id);
  const restored = loadKingdomTabs(rules);
  assert.equal(restored.tabs[0].gameId, gameId);
  assert.equal(findKingdomGameTab(restored.tabs, gameId, gameTree)?.id, saved.id);
  localStorage.clear();
});
