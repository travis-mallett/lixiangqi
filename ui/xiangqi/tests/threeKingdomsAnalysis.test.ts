import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Tree, type Rules } from 'threeKingdoms';

import { bindAnalysisKeyboard } from '../src/analysisKeyboard';
import {
  loadKingdomTabs,
  saveKingdomTabs,
  kingdomTabsKey,
  newKingdomTab,
} from '../src/analysisThreeKingdomsTabs';
import { KingdomAnalysisTree, type KingdomNode } from '../src/analysisThreeKingdomsTree';
import { AnalysisTreeView } from '../src/analysisTreeView';
import { analysisVariantPicker } from '../src/analysisVariant';

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
  threeKingdoms: { resign: 'Resign' },
};

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
