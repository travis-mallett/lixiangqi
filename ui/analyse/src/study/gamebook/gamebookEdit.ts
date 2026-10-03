import { h, type Hooks, type VNode } from 'snabbdom';

import { requestIdleCallbackSafe } from 'lib';
import { throttleWithFlush } from 'lib/async';
import { licon } from 'lib/licon';
import { mainlineChild } from 'lib/tree/ops';
import type { Gamebook, TreeNode } from 'lib/tree/types';
import { bind, type MaybeVNodes, onInsert, icon } from 'lib/view';

import type AnalyseCtrl from '@/ctrl';

export const running = (ctrl: AnalyseCtrl): boolean =>
  !!ctrl.study &&
  ctrl.study.data.chapter.gamebook &&
  !ctrl.gamebookPlay() &&
  ctrl.study.vm.gamebookOverride !== 'analyse';

export function render(ctrl: AnalyseCtrl): VNode {
  const study = ctrl.study!,
    isMyMove = ctrl.turnColor() === ctrl.data.orientation,
    isCommented = (ctrl.node.comments || []).some(c => c.text.length > 2),
    hasVariation = ctrl.tree.parentNode(ctrl.path).children.length > 1;

  let content: MaybeVNodes;

  const commentHook: Hooks = bind(
    'click',
    () => {
      study.commentForm.start(study.vm.chapterId, ctrl.path, ctrl.node);
      study.vm.toolTab('comments');
      requestIdleCallbackSafe(
        () =>
          $('#comment-text').each(function (this: HTMLTextAreaElement) {
            this.focus();
          }),
        500,
      );
    },
    ctrl.redraw,
  );

  if (!ctrl.path) {
    if (isMyMove)
      content = [
        h('div.legend.todo.clickable', { hook: commentHook, class: { done: isCommented } }, [
          icon(licon.BubbleSpeech)(),
          h('p', i18n.study.lessonInitialComment),
        ]),
        renderHint(ctrl),
      ];
    else
      content = [
        h('div.legend.clickable', { hook: commentHook }, [
          icon(licon.BubbleSpeech)(),
          h('p', i18n.study.lessonIntroduction),
        ]),
        h('div.legend.todo', { class: { done: !!mainlineChild(ctrl.node) } }, [
          icon(licon.PlayTriangle)(),
          h('p', i18n.study.lessonOpponentFirstMove),
        ]),
      ];
  } else if (ctrl.onMainline) {
    if (isMyMove)
      content = [
        h('div.legend.todo.clickable', { hook: commentHook, class: { done: isCommented } }, [
          icon(licon.BubbleSpeech)(),
          h('p', i18n.study.lessonNextMoveComment),
        ]),
        renderHint(ctrl),
      ];
    else
      content = [
        h('div.legend.clickable', { hook: commentHook }, [
          icon(licon.BubbleSpeech)(),
          h('p', i18n.study.lessonCorrectMoveComment),
        ]),
        hasVariation
          ? null
          : h('div.legend.clickable', { hook: bind('click', ctrl.navigate.prev, ctrl.redraw) }, [
              icon(licon.PlayTriangle)(),
              h('p', i18n.study.lessonAddVariations),
            ]),
        renderDeviation(ctrl),
      ];
  } else
    content = [
      h('div.legend.todo.clickable', { hook: commentHook, class: { done: isCommented } }, [
        icon(licon.BubbleSpeech)(),
        h('p', i18n.study.lessonWrongMoveComment),
      ]),
      h('div.legend', [h('p', i18n.study.lessonPromoteCorrectMove)]),
    ];

  return h(
    'div.gamebook-edit',
    { hook: onInsert(() => site.asset.loadCssPath('analyse.gamebook.edit')) },
    content,
  );
}

function renderDeviation(ctrl: AnalyseCtrl): VNode {
  const field = 'deviation';
  return h('div.deviation', [
    h('div.legend.todo', { class: { done: nodeGamebookValue(ctrl.node, field).length > 2 } }, [
      icon(licon.BubbleSpeech)(),
      h('p', i18n.study.lessonOtherWrongMoves),
    ]),
    h('textarea', {
      key: `${ctrl.study!.data.chapter.id}:${ctrl.path}`,
      attrs: { placeholder: i18n.study.lessonExplainOtherMoves },
      hook: textareaHook(ctrl, field),
    }),
  ]);
}

const renderHint = (ctrl: AnalyseCtrl): VNode =>
  h('div.hint', [
    h('div.legend', [icon(licon.InfoCircle)(), h('p', i18n.study.lessonOptionalHint)]),
    h('textarea', {
      key: `${ctrl.study!.data.chapter.id}:${ctrl.path}`,
      attrs: { placeholder: i18n.study.lessonHintPlaceholder },
      hook: textareaHook(ctrl, 'hint'),
    }),
  ]);

const nodeGamebookValue = (node: TreeNode, field: 'deviation' | 'hint'): string =>
  node.gamebook?.[field] || '';

function textareaHook(ctrl: AnalyseCtrl, field: 'deviation' | 'hint'): Hooks {
  const path = ctrl.path,
    ch = ctrl.study!.data.chapter.id;
  return {
    insert(vnode: VNode) {
      const el = vnode.elm as HTMLTextAreaElement;
      let pending: Gamebook | undefined;
      const save = throttleWithFlush(500, (gamebook: Gamebook) => {
        ctrl.socket.send('setGamebook', {
          path,
          ch,
          gamebook,
        });
        if (pending === gamebook) pending = undefined;
      });
      const flush = () => {
        if (pending) save.flush(pending);
        else save.clear();
      };
      vnode.data!.flush = flush;
      vnode.data!.node = ctrl.node;
      el.value = nodeGamebookValue(ctrl.node, field);
      el.oninput = () => {
        const node = ctrl.tree.nodeAtPath(path);
        node.gamebook = node.gamebook || {};
        node.gamebook[field] = el.value.trim();
        pending = { ...node.gamebook };
        save(pending);
      };
      el.onblur = flush;
    },
    postpatch(old: VNode, vnode: VNode) {
      vnode.data!.flush = old.data!.flush;
      vnode.data!.node = ctrl.node;
      if (old.data!.node !== ctrl.node && document.activeElement !== vnode.elm)
        (vnode.elm as HTMLTextAreaElement).value = nodeGamebookValue(ctrl.node, field);
    },
    destroy: vnode => vnode.data!.flush?.(),
  };
}
