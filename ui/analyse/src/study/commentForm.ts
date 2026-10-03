import { h, type VNode } from 'snabbdom';

import { blurOnEscape, prop } from 'lib';
import { throttleWithFlush } from 'lib/async';
import { storage } from 'lib/storage';
import type { TreeNode, TreePath } from 'lib/tree/types';
import { onInsert } from 'lib/view';

import type AnalyseCtrl from '../ctrl';
import type { ChapterId } from './interfaces';
import { currentComments, isAuthorObj } from './studyComments';

interface Current {
  chapterId: ChapterId;
  path: TreePath;
  node: TreeNode;
}

interface Update {
  chapterId: ChapterId;
  path: TreePath;
  text: string;
  revision: number;
}

interface Draft {
  text: string;
  revision: number;
  sent: number[];
}

const positionKey = (chapterId: ChapterId, path: TreePath) => `${chapterId}:${path}`;

export class CommentForm {
  current = prop<Current | null>(null);
  opening = prop(false);
  private readonly drafts = new Map<string, Draft>();
  private pending?: Update;
  private revision = 0;
  constructor(readonly root: AnalyseCtrl) {}

  submit = (text: string) => {
    const current = this.current();
    if (!current) return;
    const key = positionKey(current.chapterId, current.path);
    const revision = ++this.revision;
    this.drafts.set(key, { text, revision, sent: this.drafts.get(key)?.sent ?? [] });
    const update = { chapterId: current.chapterId, path: current.path, text, revision };
    this.pending = update;
    this.doSubmit(update);
  };

  private readonly doSubmit = throttleWithFlush(500, (update: Update) => {
    const { chapterId, path, text, revision } = update;
    if (this.root.study!.makeChange('setComment', { ch: chapterId, path, text })) {
      this.drafts.get(positionKey(chapterId, path))?.sent.push(revision);
      if (this.pending === update) this.pending = undefined;
    }
  });

  flush = () => {
    if (this.pending) this.doSubmit.flush(this.pending);
    else this.doSubmit.clear();
  };

  text = (current: Current): string =>
    this.drafts.get(positionKey(current.chapterId, current.path))?.text ??
    current.node.comments?.find(c => isAuthorObj(c.by) && c.by.id === this.root.opts.userId)?.text ??
    '';

  acknowledge = (chapterId: ChapterId, path: TreePath, sri: string) => {
    if (sri !== site.sri) return;
    const key = positionKey(chapterId, path);
    const draft = this.drafts.get(key);
    // The study socket echoes writes in order. Release a draft only when its latest
    // revision is confirmed, including when the server normalizes its whitespace.
    if (draft && draft.sent.shift() === draft.revision) this.drafts.delete(key);
  };

  start = (chapterId: string, path: TreePath, node: TreeNode): void => {
    this.onSetPath(chapterId, path, node);
    this.opening(true);
    this.current({ chapterId, path, node });
    this.root.userJump(path);
  };

  onSetPath = (chapterId: string, path: TreePath, node: TreeNode): void => {
    const cur = this.current();
    if (cur && (path !== cur.path || chapterId !== cur.chapterId || cur.node !== node)) {
      this.flush();
      this.current({ chapterId, path, node });
    }
  };
  delete = (chapterId: string, path: TreePath, id: string) => {
    this.root.study!.makeChange('deleteComment', { ch: chapterId, path, id });
  };
}

export const viewDisabled = (root: AnalyseCtrl, why: string): VNode =>
  h('div.study__comments', [currentComments(root, true), h('div.study__message', why)]);

export function view(root: AnalyseCtrl): VNode {
  const study = root.study!,
    ctrl = study.commentForm,
    current = ctrl.current();
  if (!current) return viewDisabled(root, 'Select a move to comment');

  const setupTextarea = (vnode: VNode, old?: VNode) => {
    const el = vnode.elm as HTMLTextAreaElement;
    const newKey = positionKey(current.chapterId, current.path);

    if (old?.data!.path !== newKey) {
      el.value = ctrl.text(current);
    }
    vnode.data!.path = newKey;

    if (ctrl.opening()) {
      requestAnimationFrame(() => el.focus());
      ctrl.opening(false);
    }
  };

  return h('div.study__comments', { hook: onInsert(() => root.enableWiki(true)) }, [
    currentComments(root, !study.members.canContribute()),
    h('form.form3', [
      h('textarea#comment-text.form-control', {
        attrs: { maxlength: 4000 },
        hook: {
          insert(vnode) {
            setupTextarea(vnode);
            const el = vnode.elm as HTMLTextAreaElement;
            el.oninput = () => ctrl.submit(el.value);
            el.onblur = ctrl.flush;
            const heightStore = storage.make('study.comment.height');
            el.onmouseup = () => heightStore.set(String(el.offsetHeight));
            el.style.height = parseInt(heightStore.get() || '80') + 'px';
            blurOnEscape(el);
          },
          postpatch: (old, vnode) => setupTextarea(vnode, old),
          destroy: ctrl.flush,
        },
      }),
    ]),
    h('div.analyse__wiki.study__wiki.force-ltr', h('div.analyse__wiki-text')),
  ]);
}
