import { boardAssets } from './catalog';
import { feedbackImageAsset, playFeedbackImage } from './feedbackImage';
import { feedbackLayout } from './feedbackLayout';
import { primaryBoardEffect } from './feedbackPolicy';
import { captureToRail } from './motion/captureToRail';
import type { BoardEffect, BoardPresentation, BoardServices, BoardTransition, GraphGeometry } from './types';
const images: Partial<Record<BoardEffect, { path: string; duration: number }>> = boardAssets.effects;

/** Feedback is scoped to a board; displaying a position never implicitly announces it. */
export class BoardFeedback {
  private overlay?: HTMLElement;
  private timeout?: ReturnType<typeof setTimeout>;
  private lastTransition?: string;
  private announcedMove = false;
  private readonly announcedEffects = new Set<BoardEffect>();
  private readonly imageCleanups: (() => void)[] = [];
  private destroyed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly services: BoardServices,
  ) {}

  prepare(presentation: BoardPresentation): void {
    if (this.destroyed || this.services.reducedMotion?.()) return;
    for (const effect of presentation.feedback.effects) {
      const image = images[effect];
      if (image)
        void feedbackImageAsset(this.root.ownerDocument, this.services.assetUrl(image.path)).catch(() => {});
    }
  }

  present(transition: BoardTransition, presentation: BoardPresentation, geometry?: GraphGeometry): void {
    if (this.destroyed) return;
    const document = this.root.ownerDocument;
    if (!['forward', 'optimistic', 'confirmation'].includes(transition.kind)) {
      this.clear();
      this.lastTransition = undefined;
      this.announcedEffects.clear();
      this.announcedMove = false;
      if (transition.kind === 'backward' && transition.effects !== undefined && presentation.feedback.audio)
        this.services.sound?.({ move: true, effects: [] });
      return;
    }
    if (transition.effects === undefined) return;
    if (transition.id === undefined || transition.id !== this.lastTransition) {
      this.clear();
      this.lastTransition = transition.id;
      this.announcedMove = false;
      this.announcedEffects.clear();
    }
    const move = transition.kind !== 'confirmation' && !this.announcedMove;
    const supplied = transition.kind === 'optimistic' ? [] : transition.effects;
    const previous = primaryBoardEffect([...this.announcedEffects]);
    const primary = primaryBoardEffect([...this.announcedEffects, ...supplied]);
    const audioEffects = primary && primary !== previous ? [primary] : [];
    // Three Kingdoms keeps its documented simultaneous river/territory visuals.
    // Every other board selects priority before applying visibility preferences.
    const effects = geometry?.riverAnchors
      ? supplied.filter(effect => !this.announcedEffects.has(effect))
      : audioEffects;
    if (!move && !effects.length) return;
    this.announcedMove ||= move;
    supplied.forEach(effect => this.announcedEffects.add(effect));
    if (presentation.feedback.audio && (move || audioEffects.length))
      this.services.sound?.({ move, effects: audioEffects });
    if (transition.captureToRail && effects.includes('capture')) {
      if (presentation.motion.duration && !this.services.reducedMotion?.()) {
        const finish = captureToRail(this.root, transition.captureToRail, presentation.perspective);
        if (finish) this.imageCleanups.push(finish);
      }
      return;
    }
    if (geometry?.riverAnchors) {
      const placements = feedbackLayout(
        {
          ...transition,
          effects: effects.filter(e =>
            presentation.feedback.effects.includes(e === 'defeat' ? 'checkmate' : e),
          ),
          winners:
            transition.kind !== 'optimistic' && presentation.feedback.effects.includes('checkmate')
              ? transition.winners
              : [],
        },
        geometry,
        presentation.perspective,
      );
      if (!placements.length) return;
      this.clear();
      this.overlay = document.createElement('span');
      this.overlay.className = 'xiangqi-board-animation xiangqi-board-animation--localized';
      this.overlay.style.containerType = 'inline-size';
      this.overlay.setAttribute('aria-hidden', 'true');
      const reduced = this.services.reducedMotion?.();
      for (const placement of placements) {
        const image = placement.effect === 'victory' ? undefined : images[placement.effect];
        const element = document.createElement(image && !reduced ? 'img' : 'span');
        element.className = `xiangqi-board-animation__image xiangqi-board-animation--${placement.effect}`;
        if (element.tagName === 'IMG' && image) {
          const img = element as HTMLImageElement;
          this.imageCleanups.push(playFeedbackImage(img, this.services.assetUrl(image.path), image.duration));
          img.alt = '';
          img.draggable = false;
        } else {
          element.style.fontSize = `${placement.width * 0.65}cqw`;
          element.textContent = { capture: '吃', check: '将', checkmate: '败', defeat: '败', victory: '胜' }[
            placement.effect
          ];
        }
        element.style.left = `${placement.point[0]}%`;
        element.style.top = `${placement.point[1]}%`;
        element.style.width = `${placement.width}%`;
        this.overlay.append(element);
      }
      this.root.append(this.overlay);
      // Static labels expire independently of images still loading.
      const labels = [...this.overlay.querySelectorAll('span')];
      if (labels.length)
        this.timeout = setTimeout(
          () => {
            labels.forEach(label => label.remove());
            if (this.overlay && !this.overlay.childElementCount) this.clear();
          },
          reduced ? 900 : 1500,
        );
      return;
    }
    if (this.services.reducedMotion?.()) return;
    const effect = primaryBoardEffect(effects);
    if (effect && !presentation.feedback.effects.includes(effect)) {
      this.clear();
      return;
    }
    const image = effect && images[effect];
    if (!image) return;
    this.clear();
    this.overlay = document.createElement('span');
    this.overlay.className = `xiangqi-board-animation xiangqi-board-animation--${effect}`;
    this.overlay.setAttribute('aria-hidden', 'true');
    const element = document.createElement('img');
    element.className = 'xiangqi-board-animation__image';
    element.alt = '';
    element.draggable = false;
    this.imageCleanups.push(playFeedbackImage(element, this.services.assetUrl(image.path), image.duration));
    this.overlay.append(element);
    this.root.append(this.overlay);
  }

  clear(): void {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
    this.imageCleanups.splice(0).forEach(dispose => dispose());
    this.overlay?.remove();
    this.overlay = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
  }
}
