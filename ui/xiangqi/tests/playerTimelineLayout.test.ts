import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/xiangqi.player.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
const render = parsed.statements.find(
  statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'renderProfile',
);
assert.ok(render);
const script = ts.transpileModule(render.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test('initial and subsequent profile renders measure the timeline after revealing its parent', () => {
  for (const width of [360, 720, 1102]) {
    const content = { hidden: true };
    const measured: number[] = [];
    const element = () => ({ textContent: '', classList: { remove() {} } });
    const noop = () => {};
    const context = {
      document: { querySelector: () => ({}) },
      playerNameElement: element(),
      playerRangeElement: element(),
      gamesSummary: element(),
      pageLabel: element(),
      pageStatus: element(),
      previousButton: {},
      nextButton: {},
      pageContent: content,
      page: 1,
      total: 0,
      renderSourceCounts: noop,
      renderGames: noop,
      renderSort: noop,
      renderEmptySummary: noop,
      renderTimeline: () => measured.push(content.hidden ? 0 : width),
      result: { available: true, player: { name: 'Player' }, total: 0, pageSize: 100, games: [] },
    };
    runInNewContext(`${script}\nrenderProfile(result); renderProfile(result);`, context);
    assert.deepEqual(measured, [width, width]);
  }
});
