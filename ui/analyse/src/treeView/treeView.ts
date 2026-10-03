import type { VNode, Hooks } from 'snabbdom';
import { AnalysisTreeView } from 'xiangqi';

import { hl } from 'lib/view';

import type AnalyseCtrl from '@/ctrl';
import type { ConcealOf } from '@/interfaces';

import { renderContextMenu } from './contextMenu';

/** Connect study navigation and collaborative commands to the shared move-tree renderer. */
export class TreeView {
  constructor(readonly ctrl: AnalyseCtrl) {}
  private autoScrollRequest: ScrollBehavior | false = false;
  private view?: AnalysisTreeView;
  private concealOf?: ConcealOf;

  hidden = true;
  mode: 'column' | 'inline' = 'column';

  render(concealOf?: ConcealOf): VNode {
    this.concealOf = concealOf;
    this.mode = concealOf || !this.ctrl.settings.inline ? 'column' : 'inline';
    return hl('div.xiangqi-analysis__moves', {
      class: { hidden: this.hidden, 'two-column-notation': this.mode === 'column' },
      hook: {
        insert: vnode => {
          const { ctrl } = this;
          this.view = new AnalysisTreeView({
            element: vnode.elm as HTMLElement,
            tree: () => ctrl.tree,
            activePath: () => ctrl.path,
            setActivePath: path => ctrl.userJump(path),
            navigate: path => {
              ctrl.userJump(path);
              ctrl.redraw();
            },
            notationLayout: () => (this.mode === 'column' ? 'two-column' : 'compact'),
            notationStyle: () => ctrl.data.pref.notationStyle ?? 'english',
            commit: () => ctrl.redraw(),
            children: node => ctrl.visibleChildren(node),
            conceal: (node, mainline) => this.concealOf?.(mainline)(node.path, node) ?? null,
            comments: node =>
              ctrl.showComments
                ? (node.comments ?? []).filter(
                    comment =>
                      ctrl.settings.showStaticAnalysis ||
                      !(comment.by.kind === 'site' && comment.text.endsWith(' was best.')),
                  )
                : [],
            glyphs: node => {
              if (!ctrl.showMoveGlyphs()) return [];
              const glyphs = [...(node.glyphs ?? [])];
              const live = ctrl.liveAnnotate?.get(node.path);
              if (live && ctrl.settings.showLiveAnnotations && !glyphs.some(glyph => glyph.id <= 6))
                glyphs.push(live);
              return glyphs;
            },
            evaluation: node => ctrl.allowedEval(node) || undefined,
            moveClasses: node => ({
              'context-menu': node.path === ctrl.contextMenuPath,
              'pending-deletion': node.path.startsWith(ctrl.pendingDeletionPath() || ' '),
              'pending-copy': !!ctrl.pendingCopyPath()?.startsWith(node.path),
              current: node.path === ctrl.study?.data.chapter.relayPath,
            }),
            toggleCollapsed: node => ctrl.idbTree.setCollapsed(node.path, !node.collapsed),
            contextMenu: (path, x, y) => {
              renderContextMenu(new MouseEvent('contextmenu', { clientX: x, clientY: y }), ctrl, path);
              ctrl.redraw();
            },
            emptyText: '',
          });
          this.update(true);
        },
        postpatch: () => this.update(),
        destroy: () => {
          this.view?.closeMenu();
          this.view = undefined;
        },
      },
    });
  }

  private update(initial = false): void {
    this.view?.render({ scrollToActive: initial || !!this.autoScrollRequest });
    this.autoScrollRequest = false;
  }

  requestAutoScroll(request: ScrollBehavior | false) {
    this.autoScrollRequest = request;
  }

  hook(): Hooks {
    return {};
  }
}
