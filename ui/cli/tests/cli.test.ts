import assert from 'node:assert/strict';
import { test } from 'node:test';

import { execute } from '../src/cli';

test('global search ignores empty and whitespace-only input', () => {
  const location = { href: '/' };
  Object.assign(globalThis, { location });

  execute('');
  execute('   ');

  assert.equal(location.href, '/');
});

test('global search trims valid player names before navigating', () => {
  const location = { href: '/' };
  Object.assign(globalThis, { location });

  execute('  east_grido  ');

  assert.equal(location.href, '/@/east_grido');
});
