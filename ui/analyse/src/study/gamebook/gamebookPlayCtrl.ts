import { mainlineChild } from 'lib/tree/ops';
import { path as treePath } from 'lib/tree/tree';
import type { Shape, TreePath } from 'lib/tree/types';

import { makeShapesFromUci } from '@/autoShape';
import type AnalyseCtrl from '@/ctrl';

export type Feedback = 'play' | 'good' | 'bad' | 'end';

export interface State {
  feedback: Feedback;
  comment?: string;
  hint?: string;
  showHint: boolean;
  init: boolean; // on root path
}

export default class GamebookPlayCtrl {
  state: State;
  private timers: ReturnType<typeof setTimeout>[] = [];
  destroy = () => {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  };
  private readonly later = (action: () => void, delay: number) => {
    const path = this.root.path;
    this.timers.push(
      setTimeout(() => {
        if (this.root.study?.gamebookPlay === this && this.root.path === path) action();
      }, delay),
    );
  };

  constructor(
    readonly root: AnalyseCtrl,
    readonly chapterId: string,
    readonly redraw: () => void,
  ) {
    this.makeState();
  }

  private readonly makeState = (): void => {
    this.destroy();
    const node = this.root.node,
      nodeComment = (node.comments || [])[0],
      state: Partial<State> = {
        init: this.root.path === '',
        comment: nodeComment ? nodeComment.text : undefined,
        showHint: false,
      },
      parPath = treePath.init(this.root.path),
      parNode = this.root.tree.nodeAtPath(parPath);
    if (
      (this.root.onMainline && !mainlineChild(node)) ||
      (!this.root.onMainline && !this.root.tree.pathIsMainline(parPath))
    )
      state.feedback = 'end';
    else if (this.isMyMove()) {
      state.feedback = 'play';
      state.hint = node.gamebook?.hint;
    } else if (this.root.onMainline) state.feedback = 'good';
    else {
      state.feedback = 'bad';
      if (!state.comment) state.comment = mainlineChild(parNode)?.gamebook?.deviation;
    }
    this.state = state as State;
    if (!state.comment) {
      if (state.feedback === 'good') this.later(this.next, this.root.path ? 1000 : 300);
      else if (state.feedback === 'bad') this.later(this.retry, 800);
    }
  };

  isMyMove = () => this.root.turnColor() === this.root.data.orientation;

  movableColor = (): 'red' | 'black' | undefined =>
    ['play', 'good'].includes(this.state.feedback) ? this.root.data.orientation : undefined;

  retry = () => {
    let path = this.root.path;
    while (path && !this.root.tree.pathIsMainline(path)) path = treePath.init(path);
    this.root.userJump(path);
    this.redraw();
  };

  next = () => {
    if (!this.isMyMove()) {
      const child = mainlineChild(this.root.node);
      if (child) this.root.userJump(treePath.append(this.root.path, child.id));
    }
    this.redraw();
  };

  onSpace = () => {
    switch (this.state.feedback) {
      case 'bad':
        this.retry();
        break;
      case 'end': {
        this.root.study!.goToNextChapter();
        break;
      }
      default:
        this.next();
    }
  };

  onPremoveSet = () => {
    this.next();
  };

  hint = () => {
    if (this.state.hint) this.state.showHint = !this.state.showHint;
  };

  solution = () => {
    this.root.board.setMarks(
      makeShapesFromUci(this.root.turnColor(), mainlineChild(this.root.node)?.uci, 'green'),
    );
  };

  canJumpTo = (path: TreePath) => treePath.contains(this.root.path, path);

  onJump = () => {
    this.makeState();
    // wait for the root ctrl to make the move
    this.later(() => this.root.withBoard(cg => cg.playPremove()), 100);
  };

  onShapeChange = (shapes: Shape[]) => {
    const node = this.root.node;
    if (node.gamebook?.shapes && !shapes.length) {
      node.shapes = node.gamebook.shapes.slice(0);
      this.root.jump(this.root.path);
    }
  };
}
