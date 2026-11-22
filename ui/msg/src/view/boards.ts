import { mountViewer, type GameViewer } from '@lixiangqi/viewer';
import { h } from 'snabbdom';

import { websiteBoardPresentation } from 'lib/board';
import { licon } from 'lib/licon';
import { domDialog, type Dialog } from 'lib/view/dialog';

import { replayTree, type BoardShape, type MessageBoard } from '../boardContent';
import type { BoardDraft, DraftBoard } from '../boardDraft';
import { iconButton } from './messageActions';
import { scroller } from './scroller';

const destroy = new WeakMap<HTMLElement, () => void>();

export function messageBoard(board: MessageBoard, key: string, draft?: DraftBoard, redraw?: () => void) {
  const puzzle = board.path?.match(/^\/training\/([^/#]+)/)?.[1];
  const title =
    board.title ||
    (puzzle
      ? `LiXiangQi · ${i18n.site.puzzles} #${puzzle}`
      : board.path
        ? `LiXiangQi · ${board.path.split('/').filter(Boolean)[board.path.startsWith('/three-kingdoms/') ? 2 : 0]}`
        : board.frames[0].fen.startsWith('TK1;')
          ? 'Three Kingdoms · TK1'
          : board.frames.length > 1
            ? 'Xiangqi · PGN'
            : 'Xiangqi · FEN');
  return h('div.msg-board', { key }, [
    h('header.msg-board-header', [
      h('strong', title),
      board.path
        ? h('a.msg-board-link', {
            attrs: {
              href: board.path,
              target: '_blank',
              rel: 'noopener',
              'data-icon': licon.Link,
              title: i18n.inbox.openBoardSource,
              'aria-label': i18n.inbox.openBoardSource,
            },
          })
        : h('button.msg-board-link', {
            attrs: {
              type: 'button',
              'data-icon': licon.Clipboard,
              title: i18n.inbox.copy,
              'aria-label': i18n.inbox.copy,
            },
            on: {
              click: async () => {
                try {
                  await navigator.clipboard.writeText(
                    board.code ?? board.inline ?? draft?.source.value ?? board.frames[0].fen,
                  );
                  site.announce({ msg: i18n.inbox.copySuccess });
                } catch {
                  site.announce({ msg: i18n.inbox.error });
                }
              },
            },
          }),
    ]),
    h('div.msg-board-player', {
      hook: {
        insert(vnode) {
          const element = vnode.elm as HTMLElement;
          const abort = new AbortController();
          const { signal } = abort;
          const surface = document.createElement('div');
          element.append(surface);
          let viewer: GameViewer | undefined;
          let expanded: Dialog | undefined;
          let opening = false;
          async function expand() {
            if (opening || expanded || signal.aborted) return;
            opening = true;
            try {
              const heading = document.createElement('h2');
              heading.textContent = title;
              const dlg = await domDialog({
                class: 'msg-board-expanded',
                modal: true,
                easyClose: 'clickOutside',
                attrs: { dialog: { 'aria-label': title } },
                append: [{ node: heading }],
                onClose: () => {
                  if (!signal.aborted) {
                    element.append(surface);
                    element.style.removeProperty('min-height');
                    surface.querySelector<HTMLElement>('.msg-board-enlarge')?.focus({ preventScroll: true });
                  }
                  expanded = undefined;
                },
              });
              if (signal.aborted) {
                dlg.dialog.remove();
                return;
              }
              expanded = dlg;
              element.style.minHeight = element.offsetHeight + 'px';
              dlg.view.append(surface);
              await dlg.show();
            } finally {
              opening = false;
            }
          }
          const observer = draft
            ? undefined
            : new IntersectionObserver(
                ([entry]) => {
                  if (!entry.isIntersecting) return;
                  observer!.disconnect();
                  void mount();
                },
                { rootMargin: '300px' },
              );
          async function mount() {
            const duration = Number(document.body.dataset.boardMotion);
            const presentation = websiteBoardPresentation(
              { animationDuration: Number.isFinite(duration) ? duration : undefined },
              'replay',
              board.orientation,
            );
            if (presentation.feedback.audio) site.sound?.preloadBoardSounds?.();
            try {
              const source = board.frames[0].fen.startsWith('TK1;')
                ? { root: await import('../kingdomReplay').then(module => module.loadKingdomReplay(board)) }
                : { tree: replayTree(board) };
              viewer = await mountViewer(
                surface,
                source,
                {
                  initialPly: draft?.current ?? board.start,
                  orientation: board.orientation,
                  showMoves: false,
                  inheritAppearance: true,
                  presentation: { ...presentation, drawing: !!draft },
                  drawnMarks:
                    draft &&
                    (node =>
                      (draft.marks.get(node.ply) ?? []).map(shape => ({
                        from: shape.orig,
                        to: shape.dest,
                        brush: shape.brush,
                      }))),
                  onPosition:
                    draft &&
                    (node => {
                      draft.current = node.ply;
                      queueMicrotask(() => {
                        if (!signal.aborted) redraw?.();
                      });
                    }),
                  onDraw:
                    draft &&
                    ((node, marks) => {
                      if (
                        !saveMarks(
                          draft,
                          node.ply,
                          marks.map(mark => ({
                            orig: mark.from,
                            dest: mark.to,
                            brush: mark.brush ?? 'green',
                          })),
                        )
                      )
                        viewer?.board.setMarks(
                          (draft.marks.get(node.ply) ?? []).map(shape => ({
                            from: shape.orig,
                            to: shape.dest,
                            brush: shape.brush,
                          })),
                        );
                    }),
                },
                signal,
              );
              if (draft) touchDrawing(draft, viewer, signal);
              const area = surface.querySelector<HTMLElement>('.xiangqi-viewer__board');
              if (area) {
                const activate = () => {
                  if (!draft?.drawing && !expanded) void expand();
                };
                area.classList.add('msg-board-enlarge');
                area.tabIndex = 0;
                area.setAttribute('role', 'button');
                area.setAttribute('aria-label', title + ' · ' + i18n.site.board);
                area.addEventListener('click', activate, { signal });
                area.addEventListener(
                  'keydown',
                  event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      activate();
                    }
                  },
                  { signal },
                );
              }
              scroller.auto();
            } catch {
              if (!signal.aborted) element.textContent = i18n.inbox.invalidBoard;
            }
          }
          destroy.set(element, () => {
            observer?.disconnect();
            abort.abort();
            expanded?.close();
            viewer?.destroy();
          });
          if (observer) observer.observe(element);
          else void mount();
        },
        destroy(vnode) {
          destroy.get(vnode.elm as HTMLElement)?.();
        },
      },
    }),
  ]);
}

function saveMarks(draft: DraftBoard, ply: number, shapes: BoardShape[]) {
  const others = [...draft.marks].filter(([position]) => position !== ply);
  if (
    shapes.length > 0 &&
    (others.length >= 64 || others.reduce((n, [, list]) => n + list.length, 0) + shapes.length > 128)
  )
    return false;
  if (shapes.length) draft.marks.set(ply, shapes);
  else draft.marks.delete(ply);
  return true;
}

// The board maps the pointer to Xiangqi squares and paints the marks. The toggle
// supplies a touch gesture on devices without chessground's mouse buttons.
function touchDrawing(draft: DraftBoard, viewer: GameViewer, signal: AbortSignal) {
  const surface = viewer.board.element;
  let from: string | undefined;
  surface.addEventListener(
    'pointerdown',
    e => {
      if (!draft.drawing || e.button !== 0) return;
      from = viewer.board.locationAt([e.clientX, e.clientY]);
      if (!from) return;
      e.preventDefault();
      surface.setPointerCapture(e.pointerId);
    },
    { signal },
  );
  surface.addEventListener(
    'pointercancel',
    () => {
      from = undefined;
    },
    { signal },
  );
  surface.addEventListener(
    'pointerup',
    e => {
      if (!from) return;
      const to = viewer.board.locationAt([e.clientX, e.clientY]);
      const orig = from;
      from = undefined;
      if (!to) return;
      const ply = viewer.position().ply;
      const dest = to === orig ? undefined : to;
      const shapes = [...(draft.marks.get(ply) ?? [])];
      const index = shapes.findIndex(s => s.orig === orig && s.dest === dest);
      if (index < 0) shapes.push({ orig, dest, brush: 'green' });
      else shapes.splice(index, 1);
      if (saveMarks(draft, ply, shapes))
        viewer.board.setMarks(
          shapes.map(shape => ({ from: shape.orig, to: shape.dest, brush: shape.brush })),
        );
    },
    { signal },
  );
}

export function boardDrafts(draft: BoardDraft, redraw: () => void) {
  return h('div.msg-board-drafts', [
    draft.fileError ? h('p.msg-error', i18n.inbox.invalidBoard) : undefined,
    ...draft.entries
      .filter(entry => !entry.failed || !entry.source.inline)
      .map(entry =>
        h('div.msg-board-draft', { key: entry.key, class: { drawing: entry.drawing } }, [
          entry.board
            ? messageBoard(entry.board, entry.key, entry, redraw)
            : h(
                'p',
                { attrs: { role: 'status' } },
                entry.failed ? i18n.inbox.invalidBoard : i18n.inbox.loadingBoard,
              ),
          h('div.msg-board-actions', [
            entry.board
              ? h(
                  'button.button.button-empty',
                  {
                    attrs: { type: 'button', 'aria-pressed': String(entry.drawing) },
                    on: {
                      click: () => {
                        entry.drawing = !entry.drawing;
                        redraw();
                      },
                    },
                  },
                  i18n.inbox.drawOnBoard,
                )
              : undefined,
            entry.board && entry.board.frames.length > 1
              ? h(
                  'button.button.button-empty',
                  {
                    attrs: {
                      type: 'button',
                      'aria-pressed': String(entry.current === (entry.start ?? entry.board.start)),
                    },
                    on: {
                      click: () => {
                        entry.start = entry.current;
                        redraw();
                      },
                    },
                  },
                  i18n.inbox.startFromPosition,
                )
              : undefined,
            iconButton('close', i18n.inbox.removeBoard, () => {
              draft.remove(entry);
              redraw();
            }),
          ]),
        ]),
      ),
  ]);
}
