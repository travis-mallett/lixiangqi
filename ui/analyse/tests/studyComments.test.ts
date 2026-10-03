import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesModule, h, init } from 'snabbdom';

import type { TreeComment, TreeNode } from 'lib/tree/types';

import type AnalyseCtrl from '../src/ctrl';
import { CommentForm, view } from '../src/study/commentForm';

function editor() {
  const sent: { type: string; ch: string; path: string; text: string }[] = [];
  const node = { comments: [], children: [] } as unknown as TreeNode;
  const root = {
    opts: { userId: 'author' },
    node,
    userJump: () => {},
    enableWiki: () => {},
    study: {
      members: { canContribute: () => true },
      currentChapter: () => ({ id: 'chapter1' }),
      makeChange: (type: string, data: { ch: string; path: string; text: string }) => {
        sent.push({ type, ...data });
        return true;
      },
    },
  } as unknown as AnalyseCtrl;
  const form = new CommentForm(root);
  root.study!.commentForm = form;
  form.start('chapter1', 'i10i9', node);
  const patch = init([attributesModule]);
  const mount = document.createElement('div');
  document.body.append(mount);
  let vnode = patch(mount, view(root));
  const textarea = () => (vnode.elm as HTMLElement).querySelector('textarea')!;
  const type = (text: string) => {
    textarea().value = text;
    textarea().dispatchEvent(new window.Event('input'));
  };
  const hide = () => (vnode = patch(vnode, h('div.computer-analysis')));
  const show = () => (vnode = patch(vnode, view(root)));
  const acknowledge = (text: string) => {
    node.comments = [{ id: 'mine', text, by: { kind: 'user', id: 'author', name: 'Author' } }];
    form.acknowledge('chapter1', 'i10i9', site.sri);
  };
  return {
    root,
    node,
    form,
    sent,
    textarea,
    type,
    hide,
    show,
    acknowledge,
    remove: () => {
      hide();
      (vnode.elm as HTMLElement).remove();
    },
  };
}

test('comments autosave and survive tab switches before the server acknowledges them', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = editor();
  t.after(e.remove);
  e.type('First sentence');
  e.type('First sentence\nSecond sentence');
  assert.deepEqual(e.sent, [{ type: 'setComment', ch: 'chapter1', path: 'i10i9', text: 'First sentence' }]);
  e.hide();
  assert.equal(
    e.sent[1].text,
    'First sentence\nSecond sentence',
    'closing the panel flushes its latest edit',
  );
  e.show();
  assert.equal(e.textarea().value, 'First sentence\nSecond sentence');
  e.acknowledge('First sentence');
  e.hide();
  e.show();
  assert.equal(
    e.textarea().value,
    'First sentence\nSecond sentence',
    'an older echo cannot erase a newer edit',
  );
  e.acknowledge('First sentence\nSecond sentence');
  e.hide();
  e.show();
  assert.equal(e.textarea().value, 'First sentence\nSecond sentence');
  e.type('');
  e.hide();
  e.show();
  assert.equal(e.textarea().value, '', 'an empty pending edit does not resurrect the saved comment');
  assert.equal(e.sent.at(-1)?.text, '');
});

test('delayed comments retain their original chapter and native path when navigating', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = editor();
  t.after(e.remove);
  e.type('First');
  e.type('Final on rank ten');
  const other = { comments: [], children: [] } as unknown as TreeNode;
  e.form.onSetPath('chapter2', 'a4a5', other);
  e.root.node = other;
  e.show();
  assert.deepEqual(
    e.sent.map(({ ch, path, text }) => ({ ch, path, text })),
    [
      { ch: 'chapter1', path: 'i10i9', text: 'First' },
      { ch: 'chapter1', path: 'i10i9', text: 'Final on rank ten' },
    ],
  );
  e.type('Another chapter');
  t.mock.timers.tick(500);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(e.sent.at(-1), {
    type: 'setComment',
    ch: 'chapter2',
    path: 'a4a5',
    text: 'Another chapter',
  });
  e.form.onSetPath('chapter1', 'i10i9', e.node);
  e.root.node = e.node;
  e.show();
  assert.equal(e.textarea().value, 'Final on rank ten');
});

test('acknowledged comments return to the canonical saved text, including edits from another session', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = editor();
  t.after(e.remove);
  e.type('   Saved text   ');
  e.form.acknowledge('chapter1', 'i10i9', 'another-session');
  e.hide();
  e.show();
  assert.equal(e.textarea().value, '   Saved text   ');
  e.acknowledge('Saved text');
  e.hide();
  e.show();
  assert.equal(
    e.textarea().value,
    'Saved text',
    'server whitespace normalization is retained after acknowledgement',
  );
  e.node.comments = [
    {
      id: 'mine',
      text: 'Edited elsewhere',
      by: { kind: 'user', id: 'author', name: 'Author' },
    } satisfies TreeComment,
  ];
  e.hide();
  e.show();
  assert.equal(e.textarea().value, 'Edited elsewhere', 'acknowledged drafts do not mask later saved changes');
});
