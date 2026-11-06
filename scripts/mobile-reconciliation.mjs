#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
// Read-only review aid. Applicability is a product/consumer decision, not a path heuristic.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function inspectApp(source, app, receiptPath) {
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  const receiptFile = path.join(app, receiptPath);
  if (!fs.existsSync(receiptFile))
    return {
      app,
      head,
      needsBaseline: true,
      reason: 'Checkout or receipt unavailable',
      changes: [],
      pending: [],
    };
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (receipt.version !== 1) throw new Error(`Unsupported receipt version: ${receiptFile}`);
  const baseline = receipt.websiteCommit;
  if (baseline && !/^[0-9a-f]{40}$/.test(baseline)) throw new Error(`Invalid source commit: ${receiptFile}`);
  if (baseline) git('merge-base', '--is-ancestor', baseline, head);
  const paths = new Set(
    [
      ...git('diff', '--name-only', '--no-renames', '-z', baseline || head, '--').split('\0'),
      ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
    ].filter(Boolean),
  );
  const fingerprints = receipt.reviewedWorkingTree || {};
  const changes = [...paths].sort().flatMap(file => {
    const target = path.resolve(source, file);
    if (!target.startsWith(path.resolve(source) + path.sep)) throw new Error(`Outside source: ${file}`);
    const hash = fs.existsSync(target)
      ? crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
      : null;
    return Object.hasOwn(fingerprints, file) && fingerprints[file] === hash
      ? []
      : [{ path: file, sha256: hash }];
  });
  return {
    app,
    head,
    baseline,
    needsBaseline: !baseline,
    report: receipt.report,
    changes,
    pending: receipt.pending || [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (['--json', '--check'].includes(arg)) options[arg] = true;
    else if (
      ['--mobile', '--kids'].includes(arg) &&
      process.argv[i + 1] &&
      !process.argv[i + 1].startsWith('--')
    )
      options[arg] = process.argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  const results = [
    inspectApp(
      source,
      path.resolve(options['--mobile'] || path.join(source, '../lixiangqi-mobile')),
      'doc/website-reconciliation.json',
    ),
    inspectApp(
      source,
      path.resolve(options['--kids'] || path.join(source, '../lixiangqi-mobile-kids')),
      'docs/website-reconciliation.json',
    ),
  ];
  if (options['--json']) console.log(JSON.stringify(results, null, 2));
  else
    for (const result of results) {
      console.log(
        `${result.app}: ${result.needsBaseline ? 'baseline review required' : result.baseline}; ${result.changes.length} changed source files`,
      );
      for (const item of result.pending) console.log(`  ${item.id} [${item.state}] ${item.summary}`);
      for (const file of result.changes)
        console.log(`  ${file.path}${file.sha256 === null ? ' (deleted)' : ''}`);
    }
  if (
    options['--check'] &&
    results.some(
      r => r.needsBaseline || r.changes.length || r.pending.some(p => p.state === 'review-required'),
    )
  )
    process.exitCode = 1;
}
