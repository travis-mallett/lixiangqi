import { attributesModule, classModule, h, init, type VNode } from 'snabbdom';

import { isXiangqiCapture } from 'lib/game';
import { renderAdjudication } from 'lib/game/view/adjudication';
import { licon } from 'lib/licon';
import { ShowResizeHandle } from 'lib/prefs';
import { renderColumnTree, renderIndex, type ColumnTreeNode } from 'lib/tree/columnView';
import { hl, onInsert, renderReplayControls } from 'lib/view';

import { legalMoveDests, makeXiangqiGround, uciMoveToCg } from './index';
import { SpecialRulesPlayback, type ExamplePlayback } from './specialRulesPlayback';

interface Bootstrap {
  examples: Array<{ id: string; endpoint: string }>;
  animationDuration?: number;
}

async function initExample(root: HTMLElement, endpoint: string, animationDuration?: number): Promise<void> {
  const boardElement = root.querySelector<HTMLElement>('.cg-wrap')!;
  const moves = root.querySelector<HTMLElement>('.special-rules__moves')!;
  const status = root.querySelector<HTMLElement>('.special-rules__status')!;
  const controlsElement = root.querySelector<HTMLElement>('.special-rules__controls')!;
  const chinese = document.documentElement.lang.startsWith('zh');
  const text = (english: string, zh: string) => (chinese ? zh : english);
  const patch = init([attributesModule, classModule]);
  let notice: VNode | Element = root.querySelector('.special-rules__notice')!;
  let controlsVNode: VNode | Element | undefined;
  let movesVNode: VNode | Element | undefined;
  moves.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLElement>('[data-move-ply]');
    if (target) void playback.go(Number(target.dataset.movePly));
  });
  moves.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = (event.target as Element).closest<HTMLElement>('[data-move-ply]');
    if (!target) return;
    event.preventDefault();
    void playback.go(Number(target.dataset.movePly));
  });
  const ground = makeXiangqiGround(boardElement, {
    viewOnly: true,
    resizeHandle: ShowResizeHandle.Never,
    animationDuration,
    addDimensionsCssVarsTo: root,
  });
  // Keep the empty board hidden until the server has supplied the actual starting position.
  boardElement.style.visibility = 'hidden';
  let displayed: ExamplePlayback | undefined;
  const playback = new SpecialRulesPlayback(async ply => {
    const response = await fetch(`${endpoint}${ply}`, {
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok)
      throw new Error(text('Unable to load the example. Try again.', '示例加载失败，请重试。'));
    return response.json();
  }, render);
  const movesResizeObserver =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (playback.data) {
            const tree = moves.firstElementChild;
            if (tree instanceof HTMLElement) scrollMoves(playback.data, tree);
          }
        });
  movesResizeObserver?.observe(moves);

  function render(): void {
    const data = playback.data;
    root.setAttribute('aria-busy', String(playback.pending));
    if (data && displayed !== data) {
      const before = displayed;
      ground.set({
        fen: data.state.fen,
        turnColor: data.state.turn === 'red' ? 'white' : 'black',
        check: data.state.check,
        lastMove: data.lastMove ? uciMoveToCg(data.lastMove) : undefined,
        movable: { free: false, dests: legalMoveDests(data.state.legalMoves) },
      });
      boardElement.style.visibility = 'visible';
      if (before && data.acceptedPly === before.acceptedPly + 1) {
        site.sound.move({
          capture: isXiangqiCapture(before.state.fen, data.state.fen),
          check: data.state.check,
          mate: data.state.termination === 'checkmate',
        });
      }
      renderMoveList(data);
      displayed = data;
      notice = patch(notice, h('div.special-rules__notice', [renderAdjudication(data.state)]));
    }
    moves.querySelectorAll<HTMLElement>('[data-move-ply]').forEach(button => {
      button.setAttribute('aria-disabled', String(playback.pending));
    });
    const canGoBack = !!data && (data.acceptedPly > 0 || !!data.rejected);
    const canGoForward = !!data && data.acceptedPly < data.script.length;
    controlsVNode = patch(
      controlsVNode ?? controlsElement,
      renderReplayControls({
        selector: 'div.special-rules__controls',
        enabled: {
          first: !playback.pending && canGoBack,
          prev: !playback.pending && canGoBack,
          next: !playback.pending && canGoForward,
          last: !playback.pending && canGoForward,
        },
        previousIcon: licon.JumpPrev,
        nextIcon: licon.JumpNext,
        onClick: action => navigate(action),
      }),
    );
    status.textContent =
      playback.error ??
      (playback.pending
        ? text('Checking moves…', '正在判定着法……')
        : data?.rejected
          ? text(
              'Move rejected. The board remains at the last permitted position.',
              '着法被拒绝，棋盘停留在最后允许的局面。',
            )
          : data
            ? text(`${data.acceptedPly} moves played.`, `已走${data.acceptedPly}个半回合。`)
            : '');
  }

  function renderMoveList(data: ExamplePlayback): void {
    interface NotationNode extends ColumnTreeNode<NotationNode> {
      notation: string;
      children: NotationNode[];
    }
    const nodes: NotationNode[] = data.script.map((entry, index) => ({
      id: String(index + 1),
      ply: index + 1,
      notation: chinese ? entry.chinese || entry.english : entry.english,
      children: [],
    }));
    for (let index = nodes.length - 2; index >= 0; index--) nodes[index].children = [nodes[index + 1]];
    const acceptedPly = data.acceptedPly;
    const rejectedPly = data.rejected?.ply;
    const rootNode: NotationNode = {
      id: '',
      ply: 0,
      children: nodes.length ? [nodes[0]] : [],
      notation: '',
    };
    const vnode = renderColumnTree({
      root: rootNode,
      renderMove: (node, context) =>
        hl(
          'move',
          {
            attrs: {
              role: 'button',
              tabindex: '0',
              'data-move-ply': String(node.ply),
              ...(node.ply === acceptedPly ? { 'aria-current': 'step' } : {}),
              'aria-label':
                rejectedPly === node.ply
                  ? `${node.notation}: ${text('move rejected', '着法被拒绝')}`
                  : node.notation,
            },
            class: {
              active: node.ply === acceptedPly,
              rejected: node.ply === rejectedPly,
            },
          },
          [context.withIndex && renderIndex(node.ply, true), node.notation],
        ),
      hooks: {
        ...onInsert(el => scrollMoves(data, el)),
        postpatch: (_, vnode) => scrollMoves(data, vnode.elm as HTMLElement),
      },
    });
    movesVNode = patch(movesVNode ?? moves.appendChild(document.createElement('div')), vnode);
  }

  function scrollMoves(data: ExamplePlayback, tree: HTMLElement): void {
    // The move list is a bounded scroller. Keep the initial position at the top;
    // subsequent navigation follows the selected/rejected move without moving
    // the page itself.
    if (data.acceptedPly === 0 && !data.rejected) {
      moves.scrollTop = 0;
      moves.scrollLeft = 0;
      return;
    }
    const target = tree.querySelector<HTMLElement>('.rejected') ?? tree.querySelector<HTMLElement>('.active');
    if (!target) return;
    if (!moves.clientWidth || !moves.clientHeight) return;
    const containerRect = moves.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = targetRect.top - containerRect.top + moves.scrollTop;
    const bottom = targetRect.bottom - containerRect.top + moves.scrollTop;
    const left = targetRect.left - containerRect.left + moves.scrollLeft;
    const right = targetRect.right - containerRect.left + moves.scrollLeft;
    if (top < moves.scrollTop) moves.scrollTop = top;
    else if (bottom > moves.scrollTop + moves.clientHeight) moves.scrollTop = bottom - moves.clientHeight;
    if (left < moves.scrollLeft) moves.scrollLeft = left;
    else if (right > moves.scrollLeft + moves.clientWidth) moves.scrollLeft = right - moves.clientWidth;
  }

  function navigate(action: string): void {
    const data = playback.data;
    const target =
      action === 'first'
        ? 0
        : action === 'prev'
          ? playback.previous()
          : action === 'last'
            ? (data?.script.length ?? 0)
            : data
              ? data.acceptedPly + 1
              : 0;
    if (target <= (data?.script.length ?? 0)) void playback.go(target);
  }
  root.addEventListener('keydown', event => {
    const action = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last' }[event.key];
    if (action) {
      event.preventDefault();
      navigate(action);
    }
  });
  await playback.go(0);
}

export default async function initExamples(bootstrap: Bootstrap): Promise<void> {
  await site.asset.loadPieces;
  const navigation = [...document.querySelectorAll<HTMLAnchorElement>('.special-rules .subnav a')];
  const updateNavigation = (): void => {
    const target = window.location.hash || '#overview';
    navigation.forEach(link => link.classList.toggle('active', link.getAttribute('href') === target));
  };
  window.addEventListener('hashchange', updateNavigation);
  updateNavigation();
  await Promise.all(
    bootstrap.examples.map(example => {
      const root = document.querySelector<HTMLElement>(
        `.special-rules__example[data-example-id="${example.id}"]`,
      );
      return root ? initExample(root, example.endpoint, bootstrap.animationDuration) : Promise.resolve();
    }),
  );
}
