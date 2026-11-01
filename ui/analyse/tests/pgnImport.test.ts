import assert from 'node:assert/strict';
import test from 'node:test';
import { h, init, attributesModule, type VNode } from 'snabbdom';

import type AnalyseCtrl from '../src/ctrl';
import { StudyChapterNewForm, view } from '../src/study/chapterNewForm';
import { PgnImportInput, pgnImportHelp, studyExportLinks } from '../src/study/pgnImport';
import type { StudyChapters } from '../src/study/studyChapters';

function form() {
  let closed = false;
  let switched = false;
  let sent = false;
  let redraws = 0;
  const ctrl = new StudyChapterNewForm(
    () => {
      sent = true;
    },
    {} as StudyChapters,
    false,
    () => {
      switched = true;
    },
    {
      bottomColor: () => 'red',
      redraw: () => {
        redraws++;
      },
      node: { fen: '' },
      study: {
        data: { id: 'study001', showRatings: true, chapter: {} },
        vm: { mode: { sticky: false } },
        currentChapter: () => ({ name: 'Example' }),
      },
    } as unknown as AnalyseCtrl,
  );
  ctrl.isOpen(true);
  ctrl.dialog = {
    close: () => {
      closed = true;
    },
  } as typeof ctrl.dialog;
  return { ctrl, closed: () => closed, switched: () => switched, sent: () => sent, redraws: () => redraws };
}

function descendants(node: VNode): VNode[] {
  return [
    node,
    ...(node.children ?? []).flatMap(child => (typeof child === 'object' && child ? descendants(child) : [])),
  ];
}

test('editing during a pending read immediately redraws the enabled submit button', async t => {
  const originalAsset = site.asset;
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = globalThis.matchMedia;
  site.asset = { ...originalAsset, loadCssPath: async () => {} };
  t.after(() => {
    site.asset = originalAsset;
    window.matchMedia = originalMatchMedia;
  });
  const { ctrl, redraws } = form();
  ctrl.tab('pgn');
  let resolve!: (text: string) => void;
  const pending = ctrl.loadPgn(
    new Promise(r => {
      resolve = r;
    }),
  );
  const nodes = descendants(view(ctrl));
  assert.equal(nodes.find(node => node.data?.attrs?.type === 'submit')!.data!.attrs!.disabled, true);
  const textarea = nodes.find(node => node.sel?.startsWith('textarea#chapter-pgn'))!;
  const el = document.createElement('textarea');
  textarea.elm = el;
  textarea.data!.hook!.insert!(textarea);
  const before = redraws();
  el.value = 'Manual input';
  el.dispatchEvent(new window.Event('input'));
  assert.equal(redraws(), before + 1);
  assert.equal(
    descendants(view(ctrl)).find(node => node.data?.attrs?.type === 'submit')!.data!.attrs!.disabled,
    false,
  );
  resolve('Stale download');
  await pending;
  assert.equal(ctrl.pgn.text, 'Manual input');
});

test('uploaded source retains exact file text and bytes despite textarea normalization', async () => {
  const text = '[ChapterDescription "LF\nCRLF\r\nCR\r字"]\r\n*';
  const file = new File([text], 'original.pgn');
  const input = new PgnImportInput();
  await input.load(file.text(), file);
  const textarea = document.createElement('textarea');
  textarea.value = input.text;
  assert.equal(textarea.value.includes('\r'), false);
  assert.equal(input.text, text);
  assert.deepEqual(await input.originalFile!.arrayBuffer(), await file.arrayBuffer());
  input.edit('Edited copy');
  assert.equal(await input.originalFile!.text(), text);
});

test('late reads cannot replace a newer file or manual edit, and read failures keep input', async () => {
  const input = new PgnImportInput();
  input.edit('Original');
  let resolve!: (text: string) => void;
  const older = input.load(
    new Promise(r => {
      resolve = r;
    }),
  );
  await input.load(Promise.resolve('Newest'));
  resolve('Old chapter download');
  assert.equal(await older, false);
  assert.equal(input.text, 'Newest');
  let reject!: (error: Error) => void;
  const stale = input.load(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  input.edit('Manual edit');
  reject(new Error('old failure'));
  assert.equal(await stale, false);
  assert.equal(input.loading, false);
  await assert.rejects(input.load(Promise.reject(new Error('read failed'))));
  assert.equal(input.text, 'Manual edit');
  assert.equal(input.loading, false);
});

test('pending file read cannot submit the previously selected notation', async t => {
  const { ctrl, sent } = form();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(null, { status: 204 });
  });
  ctrl.pgn.edit('Old input');
  let resolve!: (text: string) => void;
  const pending = ctrl.loadPgn(
    new Promise(r => {
      resolve = r;
    }),
  );
  await ctrl.submit({
    name: 'Example',
    pgn: ctrl.pgn.text,
    orientation: 'automatic',
    mode: 'normal',
    isDefaultName: false,
  });
  assert.equal(requests, 0);
  assert.equal(sent(), false);
  resolve('New input');
  await pending;
  assert.equal(ctrl.pgn.text, 'New input');
});

test('failed batch import preserves input, the original file, and the open form without a retry', async t => {
  const { ctrl, closed, switched, sent } = form();
  const text = '[Event "First"]\n1. a4a5 a7a6 *\n[ChapterDescription "unfinished\n"] *';
  const file = new File([text], 'keep.pgn');
  await ctrl.loadPgn(file.text(), file);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests++;
    assert.equal((init!.body as FormData).get('pgn'), text);
    return new Response('Unclosed value for header ChapterDescription', { status: 400 });
  });
  await ctrl.submit({
    name: 'Example',
    pgn: ctrl.pgn.text,
    orientation: 'automatic',
    mode: 'normal',
    isDefaultName: false,
  });
  assert.equal(requests, 1);
  assert.equal(ctrl.pgn.text, text);
  assert.equal(ctrl.pgn.originalFile, file);
  assert.match(ctrl.importError!, /Unclosed value/);
  assert.equal(closed(), false);
  assert.equal(switched(), false);
  assert.equal(sent(), false);
  ctrl.isOpen(false);
  ctrl.open();
  assert.equal(ctrl.pgn.text, text);
  assert.equal(ctrl.pgn.originalFile, file);
  assert.match(ctrl.importError!, /Unclosed value/);
});

test('successful import clears accepted input and original file before reopening', async t => {
  const { ctrl, closed, switched } = form();
  const file = new File(['1. a4a5 a7a6 *'], 'accepted.pgn');
  await ctrl.loadPgn(file.text(), file);
  ctrl.originalStudyUrl = '/study/study001';
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  await ctrl.submit({
    name: 'Example',
    pgn: ctrl.pgn.text,
    orientation: 'automatic',
    mode: 'normal',
    isDefaultName: false,
  });
  assert.equal(closed(), true);
  assert.equal(switched(), true);
  ctrl.open();
  assert.equal(ctrl.pgn.text, '');
  assert.equal(ctrl.pgn.originalFile, undefined);
  assert.equal(ctrl.originalStudyUrl, '');
  assert.equal(ctrl.importError, undefined);
  assert.equal(ctrl.importing, false);
});

test('closing cancels pending reads across reopen while preserving the previous input and file', async () => {
  const { ctrl } = form();
  const file = new File(['Previous input'], 'previous.pgn');
  await ctrl.loadPgn(file.text(), file);
  ctrl.importError = 'Previous failure';
  for (const fail of [false, true]) {
    let resolve!: (text: string) => void;
    let reject!: (error: Error) => void;
    const pending = ctrl.loadPgn(
      new Promise((ok, bad) => {
        resolve = ok;
        reject = bad;
      }),
      new File(['Late input'], 'late.pgn'),
    );
    ctrl.isOpen(false);
    assert.equal(ctrl.pgn.loading, false);
    ctrl.open();
    if (fail) reject(new Error('Late read failure'));
    else resolve('Late input');
    await pending;
    assert.equal(ctrl.pgn.text, 'Previous input');
    assert.equal(ctrl.pgn.originalFile, file);
    assert.equal(ctrl.importError, undefined);
  }
});

test('known success clears accepted content across reopen or source edits and preserves newer content', async t => {
  for (const change of ['edit', 'reopen', 'source', 'retype', 'file']) {
    const { ctrl, switched } = form();
    const rendered: string[] = [];
    t.mock.method(ctrl.root, 'redraw', () => rendered.push(ctrl.pgn.text));
    ctrl.pgn.edit('Submitted input');
    let resolve!: (response: Response) => void;
    let requests = 0;
    t.mock.method(globalThis, 'fetch', () => {
      requests++;
      return new Promise<Response>(r => {
        resolve = r;
      });
    });
    const data = {
      name: 'Example',
      pgn: ctrl.pgn.text,
      orientation: 'automatic' as const,
      mode: 'normal' as const,
      isDefaultName: false,
    };
    const pending = ctrl.submit(data);
    assert.equal(ctrl.importing, true);
    await ctrl.submit(data);
    assert.equal(requests, 1);
    if (change === 'reopen') {
      ctrl.isOpen(false);
      ctrl.open();
    } else if (change === 'edit') ctrl.pgn.edit('Newer input');
    else if (change === 'retype') ctrl.pgn.edit('Submitted input');
    else if (change === 'file') {
      const file = new File(['Submitted input'], 'new-selection.pgn');
      await ctrl.loadPgn(file.text(), file);
    } else ctrl.originalStudyUrl = '/study/second01';
    const textarea = document.createElement('textarea');
    textarea.id = 'chapter-pgn';
    textarea.value = ctrl.pgn.text;
    document.body.append(textarea);
    resolve(new Response(null, { status: 204 }));
    await pending;
    assert.equal(ctrl.isOpen(), true);
    assert.equal(switched(), false);
    assert.equal(
      ctrl.pgn.text,
      change === 'edit' ? 'Newer input' : change === 'file' ? 'Submitted input' : '',
    );
    assert.equal(ctrl.originalStudyUrl, change === 'source' ? '/study/second01' : '');
    assert.equal(ctrl.importNotice, 'success');
    assert.equal(textarea.value, ctrl.pgn.text);
    assert.equal(rendered.at(-1), ctrl.pgn.text);
    textarea.remove();
    assert.equal(ctrl.importing, false);
    t.mock.restoreAll();
  }
});

test('a failed import reports the previous request, retains new input, and allows only an explicit retry', async t => {
  const { ctrl } = form();
  ctrl.pgn.edit('Submitted input');
  let resolve!: (response: Response) => void;
  const submitted: string[] = [];
  t.mock.method(globalThis, 'fetch', (_url, init) => {
    submitted.push((init!.body as FormData).get('pgn') as string);
    return new Promise<Response>(r => (resolve = r));
  });
  const pending = ctrl.submit({
    name: 'Example',
    pgn: ctrl.pgn.text,
    orientation: 'automatic',
    mode: 'normal',
    isDefaultName: false,
  });
  ctrl.pgn.edit('Newer input');
  resolve(new Response('Old failure', { status: 400 }));
  await pending;
  assert.equal(ctrl.pgn.text, 'Newer input');
  assert.match(ctrl.importError!, /Old failure/);
  assert.equal(ctrl.importNotice, 'failure');
  assert.equal(ctrl.importing, false);
  assert.deepEqual(submitted, ['Submitted input']);
  const retry = ctrl.submit({
    name: 'Example',
    pgn: ctrl.pgn.text,
    orientation: 'automatic',
    mode: 'normal',
    isDefaultName: false,
  });
  assert.deepEqual(submitted, ['Submitted input', 'Newer input']);
  resolve(new Response(null, { status: 204 }));
  await retry;
  assert.equal(ctrl.pgn.text, '');
  assert.equal(ctrl.importNotice, 'success');
  assert.equal(ctrl.importError, undefined);
});

test('confirmed success clears accepted content without cancelling an explicit replacement read', async t => {
  for (const failRead of [false, true]) {
    const { ctrl } = form();
    ctrl.pgn.edit('Submitted input');
    let respond!: (response: Response) => void;
    t.mock.method(globalThis, 'fetch', () => new Promise<Response>(r => (respond = r)));
    const pending = ctrl.submit({
      name: 'Example',
      pgn: ctrl.pgn.text,
      orientation: 'automatic',
      mode: 'normal',
      isDefaultName: false,
    });
    let resolve!: (text: string) => void;
    let reject!: (error: Error) => void;
    const file = new File(['Submitted input'], 'explicit-new-file.pgn');
    const reading = ctrl.loadPgn(
      new Promise((ok, bad) => {
        resolve = ok;
        reject = bad;
      }),
      file,
    );
    respond(new Response(null, { status: 204 }));
    await pending;
    assert.equal(ctrl.pgn.text, '');
    assert.equal(ctrl.pgn.loading, true);
    assert.equal(ctrl.isOpen(), true);
    if (failRead) reject(new Error('Read failed'));
    else resolve('Submitted input');
    await reading;
    assert.equal(ctrl.pgn.text, failRead ? '' : 'Submitted input');
    assert.equal(ctrl.pgn.originalFile, failRead ? undefined : file);
    assert.equal(ctrl.importNotice, 'success');
    t.mock.restoreAll();
  }
});

test('network failure retains input without retry and renders an uncertain-outcome notice', async t => {
  const originalAsset = site.asset;
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = globalThis.matchMedia;
  site.asset = { ...originalAsset, loadCssPath: async () => {} };
  t.after(() => {
    site.asset = originalAsset;
    window.matchMedia = originalMatchMedia;
  });
  const { ctrl } = form();
  ctrl.pgn.edit('Submitted input');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    throw new TypeError('Connection lost');
  });
  await ctrl.submit({
    name: 'Example',
    pgn: ctrl.pgn.text,
    orientation: 'automatic',
    mode: 'normal',
    isDefaultName: false,
  });
  assert.equal(requests, 1);
  assert.equal(ctrl.pgn.text, 'Submitted input');
  assert.equal(ctrl.importNotice, 'failure');
  assert.equal(ctrl.importing, false);
  let status = descendants(view(ctrl)).find(node => node.data?.attrs?.role === 'status')!;
  assert.match(String(status.children?.[0]), /previousPgnImportUnconfirmed/);
  ctrl.importNotice = 'success';
  status = descendants(view(ctrl)).find(node => node.data?.attrs?.role === 'status')!;
  assert.match(String(status.children?.[0]), /previousPgnImportCompleted/);
});

test('original file URLs are revoked on replacement, clear, and modal removal', async t => {
  const created: Blob[] = [];
  const revoked: string[] = [];
  t.mock.method(URL, 'createObjectURL', (file: Blob) => {
    created.push(file);
    return `blob:test-${created.length}`;
  });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  const patch = init([attributesModule]);
  const mount = document.createElement('div');
  document.body.append(mount);
  const input = new PgnImportInput();
  const render = () => pgnImportHelp('', () => {}, false, input);
  const first = new File(['First'], 'first.pgn');
  await input.load(first.text(), first);
  let vnode = patch(mount, render());
  vnode = patch(vnode, render());
  assert.equal(created.length, 1);
  const second = new File(['Second'], 'second.pgn');
  await input.load(second.text(), second);
  vnode = patch(vnode, render());
  assert.deepEqual(created, [first, second]);
  assert.deepEqual(revoked, ['blob:test-1']);
  input.clearContent();
  vnode = patch(vnode, render());
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2']);
  await input.load(first.text(), first);
  vnode = patch(vnode, render());
  vnode = patch(vnode, h('div'));
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2', 'blob:test-3']);
  (vnode.elm as HTMLElement).remove();
});

test('explicit same-site study URLs produce download links without trusting uploaded content', () => {
  const origin = 'https://lixiangqi.org';
  assert.deepEqual(studyExportLinks(`${origin}/study/study001/chapter1#4`, origin), {
    study: '/study/study001.pgn',
    chapter: '/study/study001/chapter1.pgn',
  });
  assert.deepEqual(studyExportLinks('/study/study001.pgn', origin), {
    study: '/study/study001.pgn',
    chapter: undefined,
  });
  for (const url of [
    '',
    'javascript:alert(1)',
    'https://other.example/study/study001',
    '//other.example/study/study001',
    'https://user@lixiangqi.org/study/study001',
    '/study/study001/delete',
    '/study/embed/study001',
  ])
    assert.equal(studyExportLinks(url, origin), undefined);
});

test('re-export help exposes actual downloads and keeps the typed source URL on redraw', () => {
  const patch = init([attributesModule]);
  const mount = document.createElement('div');
  document.body.append(mount);
  let source = '/study/study001/chapter1';
  const input = new PgnImportInput();
  let vnode = patch(
    mount,
    pgnImportHelp(
      source,
      value => {
        source = value;
      },
      true,
      input,
    ),
  );
  const root = vnode.elm as HTMLElement;
  assert.equal(root.hasAttribute('open'), true);
  assert.equal(root.querySelector<HTMLInputElement>('input')!.value, source);
  assert.deepEqual(
    [...root.querySelectorAll('a')].map(a => a.getAttribute('href')),
    ['/study/study001.pgn', '/study/study001/chapter1.pgn'],
  );
  const field = root.querySelector('input')!;
  field.value = '/study/second01';
  field.dispatchEvent(new window.Event('input'));
  vnode = patch(
    vnode,
    pgnImportHelp(
      source,
      value => {
        source = value;
      },
      true,
      input,
    ),
  );
  assert.equal((vnode.elm as HTMLElement).querySelector('a')!.getAttribute('href'), '/study/second01.pgn');
  (vnode.elm as HTMLElement).remove();
});
