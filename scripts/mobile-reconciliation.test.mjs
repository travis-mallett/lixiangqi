import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { inspectApp } from './mobile-reconciliation.mjs';

test('review detects committed, staged, unstaged, deleted and new files and invalidates stale fingerprints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lq-reconciliation-'));
  try {
    const source = path.join(root, 'website'),
      app = path.join(root, 'mobile');
    fs.mkdirSync(source);
    fs.mkdirSync(app);
    const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    for (const name of ['committed', 'staged', 'unstaged', 'deleted'])
      fs.writeFileSync(path.join(source, name), 'before');
    git('add', '.');
    git('commit', '-qm', 'Baseline');
    const websiteCommit = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(source, 'committed'), 'after');
    git('add', 'committed');
    git('commit', '-qm', 'Change');
    fs.writeFileSync(path.join(source, 'staged'), 'after');
    git('add', 'staged');
    fs.writeFileSync(path.join(source, 'unstaged'), 'after');
    fs.unlinkSync(path.join(source, 'deleted'));
    fs.writeFileSync(path.join(source, 'new'), 'after');
    const receipt = { version: 1, websiteCommit, pending: [{ id: 'V', state: 'deferred-by-user' }] };
    const save = () => fs.writeFileSync(path.join(app, 'receipt.json'), JSON.stringify(receipt));
    save();
    const result = inspectApp(source, app, 'receipt.json');
    assert.deepEqual(
      result.changes.map(c => c.path),
      ['committed', 'deleted', 'new', 'staged', 'unstaged'],
    );
    assert.equal(result.changes.find(c => c.path === 'deleted').sha256, null);
    receipt.reviewedWorkingTree = {
      unstaged: crypto.createHash('sha256').update('after').digest('hex'),
      deleted: null,
    };
    save();
    assert.deepEqual(
      inspectApp(source, app, 'receipt.json').changes.map(c => c.path),
      ['committed', 'new', 'staged'],
    );
    fs.writeFileSync(path.join(source, 'unstaged'), 'another edit');
    assert(inspectApp(source, app, 'receipt.json').changes.some(c => c.path === 'unstaged'));
    assert(inspectApp(source, app, 'missing.json').needsBaseline);
  } finally {
    // Only this test's unique temporary tree can be removed.
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
