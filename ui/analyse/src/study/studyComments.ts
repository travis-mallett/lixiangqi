import { h, type VNode } from 'snabbdom';

import { licon } from 'lib/licon';
import { richHTML } from 'lib/richText';
import { bind, confirm } from 'lib/view';

import type AnalyseCtrl from '../ctrl';
import { nodeFullName } from '../view/util';
import type StudyCtrl from './studyCtrl';

export type Author = import('lib/game/xiangqiNotation').CommentAuthor;
export type AuthorObj = Extract<Author, { kind: 'user' }>;

export const isAuthorObj = (author: Author): author is AuthorObj => author.kind === 'user';

export const authorText = (author: Author): string => {
  switch (author.kind) {
    case 'user':
    case 'external':
      return author.name;
    case 'site':
      return 'LiXiangQi';
    case 'unknown':
      return i18n.site.anonymous;
  }
};

function authorDom(author: Author): string | VNode {
  return author.kind === 'user'
    ? h('span.user-link.ulpt', { attrs: { 'data-href': '/@/' + author.id } }, author.name)
    : authorText(author);
}

export function currentComments(ctrl: AnalyseCtrl, includingMine: boolean): VNode | undefined {
  if (!ctrl.node.comments) return;
  const node = ctrl.node,
    study: StudyCtrl = ctrl.study!,
    chapter = study.currentChapter(),
    comments = node.comments!;
  if (!comments.length) return;
  return h(
    'div',
    comments.map(comment => {
      const by: Author = comment.by;
      const isMine = isAuthorObj(by) && by.id === ctrl.opts.userId;
      if (!includingMine && isMine) return;
      return h('div.study__comment.' + comment.id, [
        study.members.canContribute() && study.vm.mode.write
          ? h('a.edit', {
              attrs: { 'data-icon': licon.Trash, title: 'Delete' },
              hook: bind('click', async () => {
                if (await confirm('Delete ' + authorText(by) + "'s comment?")) {
                  study.commentForm.delete(chapter.id, ctrl.path, comment.id);
                  ctrl.redraw();
                }
              }),
            })
          : null,
        authorDom(by),
        ...(node.notation ? [' on ', h('span.node', nodeFullName(node))] : []),
        ': ',
        h('div.text', { hook: richHTML(comment.text) }),
      ]);
    }),
  );
}
