import assert from 'node:assert/strict';
import { test } from 'node:test';
import { h, init } from 'snabbdom';

import type AnalyseCtrl from '../src/ctrl';
import { DescriptionCtrl } from '../src/study/description';
import { render as lessonEditor } from '../src/study/gamebook/gamebookEdit';
import type { StudyChapterConfig } from '../src/study/interfaces';
import type StudyCtrl from '../src/study/studyCtrl';
import { GlyphForm } from '../src/study/studyGlyph';

document.documentElement.lang = 'en';
const { TagsForm } = await import('../src/study/studyTags');

document.documentElement.lang = 'en';
const { StudyChapterEditForm } = await import('../src/study/chapterEditForm');

test('description writes retain their chapter and flush the latest text before leaving', () => {
  let chapter = 'one';
  const sent: unknown[] = [];
  const ctrl = new DescriptionCtrl(
    '',
    text => {
      const id = chapter;
      return () => sent.push({ id, text });
    },
    () => {},
  );
  ctrl.save('First');
  ctrl.save('Latest');
  chapter = 'two';
  ctrl.set('Other chapter');
  assert.deepEqual(sent, [
    { id: 'one', text: 'First' },
    { id: 'one', text: 'Latest' },
  ]);
  assert.equal(ctrl.text, 'Other chapter');
});

test('rapid independent tag and glyph edits are neither dropped nor retargeted', () => {
  const sent: unknown[] = [];
  const root = {
    data: { chapter: { id: 'one' } },
    vm: { mode: { write: true } },
    makeChange: (type: string, data: unknown) => sent.push({ type, data }),
    withPosition: (data: object) => ({ ...data, chapterId: 'one', path: 'i1i2/i10i9' }),
  } as unknown as StudyCtrl;
  const tags = new TagsForm(root, []);
  tags.submit('Event', 'Example');
  tags.submit('Red', 'Alice');
  tags.submit('Black', 'Bob');
  const glyphs = new GlyphForm({ study: root, redraw: () => {} } as unknown as AnalyseCtrl);
  glyphs.toggleGlyph(1);
  glyphs.toggleGlyph(2);
  glyphs.toggleGlyph(3);
  assert.equal(sent.length, 6);
  root.data.chapter.id = 'two';
  assert.equal((sent[2] as { data: { chapterId: string } }).data.chapterId, 'one');
});

test('late chapter configuration responses cannot reopen or replace the selected editor', async () => {
  const responses: ((data: StudyChapterConfig) => void)[] = [];
  const form = new StudyChapterEditForm(
    () => {},
    () => new Promise(resolve => responses.push(resolve)),
    false,
    () => {},
  );
  const one = { id: 'one', name: 'One' } as StudyChapterConfig;
  const two = { id: 'two', name: 'Two' } as StudyChapterConfig;
  form.open(one);
  form.open(two);
  responses[0](one);
  await Promise.resolve();
  assert.equal(form.current(), two);
  form.current(null);
  responses[1](two);
  await Promise.resolve();
  assert.equal(form.current(), null);
});

test('failed chapter configuration loading can be retried', async () => {
  let requests = 0;
  const data = { id: 'one', name: 'One' } as StudyChapterConfig;
  const form = new StudyChapterEditForm(
    () => {},
    async () => {
      if (++requests === 1) throw new Error('offline');
      return data;
    },
    false,
    () => {},
  );
  form.open(data);
  await Promise.resolve();
  assert.equal(form.failed, true);
  form.open(data);
  await Promise.resolve();
  assert.equal(form.failed, false);
  assert.equal(form.current(), data);
});

test('lesson edits follow a reloaded node and flush to their captured position on navigation', t => {
  const originalI18n = globalThis.i18n;
  globalThis.i18n = { study: {} } as I18n;
  t.after(() => {
    globalThis.i18n = originalI18n;
  });
  const originalAsset = site.asset;
  site.asset = { loadCssPath: () => {} } as unknown as Site['asset'];
  t.after(() => {
    site.asset = originalAsset;
  });
  const sent: unknown[] = [];
  const makeNode = () => ({ comments: [], children: [], gamebook: {} });
  const ctrl = {
    node: makeNode(),
    path: '',
    data: { orientation: 'red' },
    turnColor: () => 'red',
    tree: { parentNode: () => ({ children: [] }), nodeAtPath: () => ctrl.node },
    study: { data: { chapter: { id: 'chapter1' } } },
    socket: { send: (type: string, data: unknown) => sent.push({ type, data }) },
  } as unknown as AnalyseCtrl;
  const patch = init([]);
  const mount = document.createElement('div');
  document.body.append(mount);
  let vnode = patch(mount, lessonEditor(ctrl));
  ctrl.node = { ...ctrl.node, gamebook: {} };
  vnode = patch(vnode, lessonEditor(ctrl));
  const el = (vnode.elm as HTMLElement).querySelector('textarea')!;
  el.value = 'First';
  el.dispatchEvent(new window.Event('input'));
  el.value = 'Final';
  el.dispatchEvent(new window.Event('input'));
  assert.equal(ctrl.node.gamebook?.hint, 'Final');
  ctrl.path = 'i1i2';
  vnode = patch(vnode, h('div'));
  assert.deepEqual(sent, [
    { type: 'setGamebook', data: { ch: 'chapter1', path: '', gamebook: { hint: 'First' } } },
    { type: 'setGamebook', data: { ch: 'chapter1', path: '', gamebook: { hint: 'Final' } } },
  ]);
  (vnode.elm as HTMLElement).remove();
});
