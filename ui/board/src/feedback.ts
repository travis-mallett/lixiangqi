import { boardAssets } from './catalog';
import { feedbackLayout } from './feedbackLayout';
import type { BoardEffect, BoardPresentation, BoardServices, BoardTransition, GraphGeometry } from './types';
const images: Partial<Record<BoardEffect, { path: string; duration: number }>> = boardAssets.effects;
const preloadedImages = new WeakMap<Document, Set<string>>();

/** Feedback is scoped to a board; displaying a position never implicitly announces it. */
export class BoardFeedback {
  private overlay?: HTMLElement;
  private timeout?: ReturnType<typeof setTimeout>;
  private lastTransition?: string;
  private announcedMove = false;
  private readonly announcedEffects = new Set<BoardEffect>();
  private sequence = 0;
  private destroyed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly services: BoardServices,
  ) {}

  prepare(presentation: BoardPresentation): void {
    if (this.destroyed || this.services.reducedMotion?.()) return;
    const document = this.root.ownerDocument;
    let loaded = preloadedImages.get(document);
    if (!loaded) preloadedImages.set(document, (loaded = new Set()));
    for (const effect of presentation.feedback.effects) {
      const image = images[effect];
      if (!image) continue;
      const url = this.services.assetUrl(image.path);
      if (loaded.has(url)) continue;
      loaded.add(url);
      // Warm the HTTP cache without starting an animated image offscreen.
      const link = document.createElement('link');
      link.rel = 'preload';
      link.setAttribute('as', 'image');
      link.href = url;
      link.onerror = () => {
        loaded.delete(url);
        link.remove();
      };
      document.head.append(link);
    }
  }

  present(transition: BoardTransition, presentation: BoardPresentation, geometry?: GraphGeometry): void {
    if (this.destroyed) return;
    if (!['forward', 'backward', 'confirmation'].includes(transition.kind)) {
      this.clear();
      this.lastTransition = undefined;
      this.announcedEffects.clear();
      this.announcedMove = false;
      return;
    }
    if (transition.kind === 'backward') this.clear();
    if (transition.effects === undefined) return;
    if (transition.id === undefined || transition.id !== this.lastTransition) {
      this.clear();
      this.lastTransition = transition.id;
      this.announcedMove = false;
      this.announcedEffects.clear();
    }
    const move = transition.kind !== 'confirmation' && !this.announcedMove;
    const effects = transition.effects.filter(effect => !this.announcedEffects.has(effect));
    if (!move && !effects.length) return;
    this.announcedMove ||= move;
    effects.forEach(effect => this.announcedEffects.add(effect));
    if (presentation.feedback.audio) this.services.sound?.({ move, effects });
    if (transition.kind === 'backward') return;
    if (geometry?.riverAnchors) {
      const placements = feedbackLayout(
        {
          ...transition,
          effects: effects.filter(e =>
            presentation.feedback.effects.includes(e === 'defeat' ? 'checkmate' : e),
          ),
          winners: presentation.feedback.effects.includes('checkmate') ? transition.winners : [],
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
          img.src = `${this.services.assetUrl(image.path)}#${++this.sequence}`;
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
      this.timeout = setTimeout(() => this.clear(), reduced ? 900 : 1500);
      return;
    }
    if (this.services.reducedMotion?.()) return;
    const effect = (['checkmate', 'check', 'capture'] as const).find(
      name => effects.includes(name) && presentation.feedback.effects.includes(name) && images[name],
    );
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
    element.src = `${this.services.assetUrl(image.path)}#${++this.sequence}`;
    this.overlay.append(element);
    this.root.append(this.overlay);
    this.timeout = setTimeout(() => this.clear(), image.duration);
  }

  clear(): void {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
    this.overlay?.remove();
    this.overlay = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
  }
}
