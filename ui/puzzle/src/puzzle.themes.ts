import type { Api } from 'chessgroundx/api';
import { makeXiangqiGround, uciMoveToCg } from 'xiangqi';

import { ShowResizeHandle } from 'lib/prefs';

import { lessonMoveMillis, ThemeLessonPlayback } from './themeLessonPlayback';

export function initModule(): void {
  const page = document.querySelector<HTMLElement>('.puzzle-themes-page')!;
  page.querySelectorAll<HTMLDetailsElement>('.puzzle-theme-lesson').forEach(initThemeLesson);
}

interface Lesson {
  fen: string;
  check: boolean;
  moves: { uci: string; check: boolean }[];
}

function initThemeLesson(details: HTMLDetailsElement): void {
  const lesson: Lesson = JSON.parse(details.dataset.lesson!);
  const startingColor = lesson.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const card = details.closest<HTMLElement>('.puzzle-themes__card')!;
  const summary = details.querySelector<HTMLElement>('summary')!;
  const content = details.querySelector<HTMLElement>('.puzzle-theme-lesson__content')!;
  const stage = details.querySelector<HTMLElement>('.puzzle-theme-lesson__stage')!;
  const overview = details.querySelector<HTMLElement>('.puzzle-theme-lesson__overview')!;
  const player = details.querySelector<HTMLElement>('.puzzle-theme-lesson__player')!;
  const closeButton = details.querySelector<HTMLButtonElement>('.puzzle-theme-lesson__close')!;
  const board = details.querySelector<HTMLElement>('.cg-wrap')!;
  const iframe = details.querySelector('iframe')!;
  const play = details.querySelector<HTMLButtonElement>('.puzzle-theme-lesson__play')!;
  let ground: Api | undefined;
  let open = false;
  let watching = false;
  let viewAnimations: Animation[] = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animationMillis = reducedMotion.matches ? 0 : lessonMoveMillis;
  const playback = new ThemeLessonPlayback(
    lesson.moves.length,
    ply => {
      if (!ground) return;
      if (!ply) {
        ground.set({
          animation: { enabled: false },
          fen: lesson.fen,
          lastMove: undefined,
          check: lesson.check ? startingColor : false,
          turnColor: startingColor,
        });
        ground.set({ animation: { enabled: animationMillis > 0 } });
      } else {
        const step = lesson.moves[ply - 1];
        const move = uciMoveToCg(step.uci);
        const turnColor = ply % 2 ? (startingColor === 'white' ? 'black' : 'white') : startingColor;
        ground.move(move[0], move[1]);
        ground.set({
          lastMove: move,
          turnColor,
          check: step.check ? turnColor : false,
        });
      }
    },
    animationMillis,
  );

  function close(): void {
    details.open = false;
    summary.focus({ preventScroll: true });
  }

  function setVideo(show: boolean, animate = true): void {
    if (watching === show) return;
    const previousHeight = stage.getBoundingClientRect().height;
    viewAnimations.forEach(animation => animation.cancel());
    viewAnimations = [];
    playback.stop();
    watching = show;
    overview.hidden = show;
    player.hidden = !show;
    const label = (show ? closeButton.dataset.back : closeButton.dataset.close)!;
    closeButton.title = label;
    closeButton.setAttribute('aria-label', label);
    if (show) {
      // Assign during the click so the player can use the user's playback gesture.
      iframe.src = iframe.dataset.src!;
      if (animate) {
        closeButton.focus({ preventScroll: true });
        content.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      }
    } else {
      iframe.removeAttribute('src');
      ground?.redrawAll();
      if (open && !document.hidden) playback.resume();
      if (animate) play.focus({ preventScroll: true });
    }
    if (animate && !reducedMotion.matches) {
      const view = show ? player : overview;
      viewAnimations = [
        stage.animate(
          [{ height: `${previousHeight}px` }, { height: `${stage.getBoundingClientRect().height}px` }],
          { duration: 300, easing: 'ease' },
        ),
        view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' }),
      ];
    }
  }

  function release(): void {
    setVideo(false, false);
    viewAnimations.forEach(animation => animation.cancel());
    viewAnimations = [];
    playback.stop();
    ground?.destroy();
    ground = undefined;
  }

  details.addEventListener('toggle', () => {
    if (details.open === open) return;
    open = details.open;
    if (open) {
      card.classList.add('puzzle-themes__card--learning');
      ground = makeXiangqiGround(board, {
        fen: lesson.fen,
        viewOnly: true,
        resizeHandle: ShowResizeHandle.Never,
        animationDuration: animationMillis,
        addDimensionsCssVarsTo: content,
      });
      ground.set({ drawable: { enabled: false, visible: false } });
      playback.start();
    } else {
      release();
      // Keep the shared card background until its native closing animation has finished.
      void Promise.allSettled(
        details
          .getAnimations({ subtree: true })
          .filter(
            animation => animation instanceof CSSTransition && animation.transitionProperty === 'height',
          )
          .map(animation => animation.finished),
      ).then(() => {
        if (!details.open) card.classList.remove('puzzle-themes__card--learning');
      });
    }
  });
  function dismiss(): void {
    if (watching) setVideo(false);
    else close();
  }

  closeButton.addEventListener('click', dismiss);
  details.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      dismiss();
    }
  });
  play.addEventListener('click', () => setVideo(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) playback.stop();
    else if (open && !watching) playback.resume();
  });
  const observer = new ResizeObserver(() => {
    if (!watching) ground?.redrawAll();
  });
  observer.observe(board);
  window.addEventListener('pagehide', () => {
    release();
    observer.disconnect();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      close();
      observer.observe(board);
    }
  });
}
