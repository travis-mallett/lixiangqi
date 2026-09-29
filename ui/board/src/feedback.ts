import { boardAssets } from './catalog';
import type { BoardEffect, BoardPresentation, BoardServices, BoardTransition } from './types';
const images: Partial<Record<BoardEffect, { path: string; duration: number }>> = boardAssets.effects;

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

  present(transition: BoardTransition, presentation: BoardPresentation): void {
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
    if (transition.kind === 'backward' || this.services.reducedMotion?.()) return;
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
