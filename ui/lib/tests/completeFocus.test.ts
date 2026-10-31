import assert from 'node:assert/strict';
import { test } from 'node:test';

import { complete } from '../src/view/complete';

const cash = await import('../../../public/javascripts/vendor/cash.min.js');
Object.assign(globalThis, { $: cash.default });
const settle = () => new Promise(resolve => setTimeout(resolve, 130));

test('suggestion focus survives Tab and Shift+Tab transitions and dismisses on exit', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<input><button>Outside</button>';
  document.body.append(root);
  const input = root.querySelector('input')!;
  input.value = 'east';
  complete({
    input,
    fetch: async () => ['east_grido'],
    render: name => `<a class="complete-result" href="#${name}">${name}</a>`,
    populate: name => name,
  });
  try {
    input.focus();
    await settle();
    const list = root.querySelector('.complete-list')!;
    const link = list.querySelector('a')!;
    // jsdom does not implement native Tab traversal; focus the actual Tab destination.
    link.focus();
    await settle();
    assert.equal(document.activeElement, link);
    assert(!list.classList.contains('none'));
    input.focus();
    await settle();
    assert(!list.classList.contains('none'));
    list.querySelector('a')!.focus();
    root.querySelector('button')!.focus();
    await settle();
    assert(list.classList.contains('none'));
  } finally {
    root.remove();
  }
});

test('span consumers retain mouse selection and arrow/Enter callbacks', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<input>';
  document.body.append(root);
  const input = root.querySelector('input')!;
  const selected: string[] = [];
  input.value = 'east';
  complete({
    input,
    fetch: async () => ['east_grido'],
    render: name => `<span class="complete-result">${name}</span>`,
    populate: name => name,
    onSelect: name => selected.push(name),
  });
  try {
    input.focus();
    await settle();
    root.querySelector('span')!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    assert.deepEqual(selected, ['east_grido']);
    input.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
    assert.deepEqual(selected, ['east_grido', 'east_grido']);
    assert(root.querySelector('.complete-list')!.classList.contains('none'));
  } finally {
    root.remove();
  }
});

test('late results preserve focused suggestions and do not reopen dismissed lists', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<input><button>Outside</button>';
  document.body.append(root);
  const input = root.querySelector('input')!;
  let resolveFetch: (results: string[]) => void = () => {};
  complete({
    input,
    fetch: () => new Promise<string[]>(resolve => (resolveFetch = resolve)),
    render: name => `<a class="complete-result" href="#${name}">${name}</a>`,
    populate: name => name,
  });
  try {
    input.value = 'east';
    input.focus();
    resolveFetch(['east_grido']);
    await settle();
    const list = root.querySelector('.complete-list')!;
    const link = list.querySelector('a')!;
    input.value = 'east_';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    link.focus();
    resolveFetch(['east_other']);
    await settle();
    assert.equal(document.activeElement, link);
    assert.equal(list.querySelector('a'), link);
    assert(!list.classList.contains('none'));
    input.focus();
    input.value = 'west';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    root.querySelector('button')!.focus();
    await settle();
    resolveFetch(['west_player']);
    await settle();
    assert(list.classList.contains('none'));
    assert.equal(document.activeElement, root.querySelector('button'));
  } finally {
    root.remove();
  }
});
