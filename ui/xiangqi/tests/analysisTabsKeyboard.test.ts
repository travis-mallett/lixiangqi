import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bindAnalysisKeyboard } from '../src/analysisKeyboard';
import { AnalysisTabsView } from '../src/analysisTabsView';
import type { AnalysisNode, AnalysisTree } from '../src/analysisTreeView';

test('tab arrows select and retain focus without navigating either history', () => {
  // Disposable presentation-only histories: no rules engine or persistent storage.
  const tabs = [
    { id: 'a1', title: 'A1', kind: 'analysis' as const, moves: ['a4a5', 'a7a6'], path: 'a4a5' },
    { id: 'a2', title: 'A2', kind: 'analysis' as const, moves: ['h3e3', 'h10g8'], path: '' },
  ];
  const models = tabs.map(tab => {
    const root: AnalysisNode = { id: '', path: '', ply: 0, children: [] };
    const first: AnalysisNode = { id: tab.moves[0], path: tab.moves[0], ply: 1, children: [] };
    first.children.push({ id: tab.moves[1], path: tab.moves.join('/'), ply: 2, children: [] });
    root.children.push(first);
    const nodes = [root, first, first.children[0]];
    return {
      root,
      nodeAtPath: path => nodes.find(node => node.path === path)!,
      parentNode: path => nodes[Math.max(0, nodes.findIndex(node => node.path === path) - 1)],
    } as AnalysisTree<AnalysisNode>;
  });
  const mount = document.createElement('div');
  document.body.append(mount);
  let active = 0;
  const view = new AnalysisTabsView({
    element: mount,
    tabs: () => tabs,
    activeId: () => tabs[active].id,
    pending: () => false,
    select: id => {
      active = tabs.findIndex(tab => tab.id === id);
      view.render();
    },
    close() {},
    add() {},
    rename() {},
  });
  bindAnalysisKeyboard(
    () => models[active],
    () => tabs[active].path,
    path => {
      tabs[active].path = path;
      view.render();
    },
  );
  const button = (index: number) => mount.querySelectorAll<HTMLButtonElement>('[role=tab]')[index];
  const key = (target: Element, key: string) =>
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  try {
    view.render();
    button(0).focus();
    key(button(0), 'ArrowRight');
    assert.equal(active, 1);
    assert.deepEqual(
      tabs.map(tab => tab.path),
      ['a4a5', ''],
    );
    assert.equal(document.activeElement, button(1));
    key(button(1), 'ArrowLeft');
    assert.equal(active, 0);
    assert.deepEqual(
      tabs.map(tab => tab.path),
      ['a4a5', ''],
    );
    assert.equal(document.activeElement, button(0));
    key(button(0), 'ArrowLeft');
    assert.equal(active, 1, 'arrows wrap around');
    assert.equal(document.activeElement, button(1));
    button(0).click();
    assert.deepEqual(
      tabs.map(tab => tab.path),
      ['a4a5', ''],
    );
    key(document.body, 'ArrowRight');
    assert.equal(tabs[0].path, 'a4a5/a7a6', 'history arrows still work outside the tabs');
    key(document.body, 'ArrowLeft');
    assert.equal(tabs[0].path, 'a4a5');
  } finally {
    window.dispatchEvent(new window.Event('pagehide'));
    mount.remove();
  }
});
