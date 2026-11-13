import { frag, requestIdleCallbackSafe } from 'lib';

import { carouselHistoryFocus } from './carouselHistoryFocus';

type CarouselOpts = {
  selector: string;
  itemWidth: number;
  pauseFor: Seconds;
  slideFor?: Seconds;
};

// Adapted from https://github.com/lichess-org/lila/blob/master/ui/lobby/src/view/carousel.ts.
export function makeCarousel({ selector, itemWidth, pauseFor, slideFor = 0.6 }: CarouselOpts): void {
  const restoreHistoryFocus = carouselHistoryFocus(selector);
  let restoredLink: HTMLAnchorElement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let slide: ReturnType<typeof setTimeout> | undefined;

  requestIdleCallbackSafe(() => {
    const el = document.querySelector<HTMLElement>(selector)!;
    if (!el) return;
    const track = el.querySelector<HTMLElement>('.carousel__track')!;
    let navigate: (forward: boolean) => void;
    let gesture: { id: number; x: number; y: number } | undefined;
    let suppressClick = false;
    el.addEventListener('pointerdown', event => {
      suppressClick = false;
      if (event.isPrimary && event.pointerType !== 'mouse')
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    el.addEventListener('pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      gesture = undefined;
      if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
      suppressClick = true;
      navigate(dx < 0);
    });
    el.addEventListener('pointercancel', () => (gesture = undefined));
    el.addEventListener(
      'click',
      event => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );

    onResize();
    el.style.visibility = 'visible';
    restoreHistoryFocus(el, link => {
      while (track.firstElementChild !== link) track.append(track.firstElementChild!);
      onResize();
      restoredLink = link;
    });
    window.addEventListener('resize', onResize);

    function onResize() {
      const kids = [...track.children].filter((k): k is HTMLElement => k instanceof HTMLElement);
      const styleGap = toPx('gap', el);
      const gap = Number.isNaN(styleGap) ? 0 : styleGap;
      const visible = Math.max(1, Math.floor((el.clientWidth + gap) / (itemWidth + gap)));
      const itemW = (el.clientWidth - gap * (visible - 1)) / visible;

      kids.forEach(k => (k.style.width = `${itemW}px`));
      kids.forEach(k => (k.style.marginRight = `${gap}px`));
      const rotateForwards = () => {
        // Keep the restored card available until keyboard focus leaves it.
        if (restoredLink === document.activeElement) return;
        kids.forEach(k => (k.style.transition = `transform ${slideFor}s ease`));
        kids.forEach(k => (k.style.transform = `translateX(-${itemW + gap}px)`));
        slide = setTimeout(() => {
          track.append(track.firstChild!);
          fix(false);
        }, slideFor * 1000);
      };
      navigate = forward => {
        if (kids.length <= visible) return;
        if (forward) track.append(track.firstChild!);
        else track.prepend(track.lastChild!);
        fix();
        timer = setInterval(rotateForwards, pauseFor * 1000);
      };
      $(el)
        .off('click.carousel')
        .on('click.carousel', '.carousel__prev', () => {
          navigate(false);
        })
        .on('click.carousel', '.carousel__next', () => {
          navigate(true);
        });
      const fix = (killTimer = true) => {
        clearTimeout(slide);
        kids.forEach(k => (k.style.transition = ''));
        kids.forEach(k => (k.style.transform = ''));
        if (killTimer) clearInterval(timer);
      };
      fix();
      if (kids.length > visible) timer = setInterval(rotateForwards, pauseFor * 1000);
    }
  });
}

function toPx(key: keyof CSSStyleDeclaration, contextEl: HTMLElement): number {
  const style = window.getComputedStyle(contextEl);
  const el = frag<HTMLElement>(`<div style="position:absolute;visibility:hidden;width:${style[key]}"/>`);
  contextEl.append(el);
  const pixels = parseFloat(window.getComputedStyle(el).width);
  el.remove();
  return pixels;
}
