import { frag, requestIdleCallbackSafe } from 'lib';

type CarouselOpts = {
  selector: string;
  itemWidth: number;
  pauseFor: Seconds;
  slideFor?: Seconds;
};

// Adapted from https://github.com/lichess-org/lila/blob/master/ui/lobby/src/view/carousel.ts.
export function makeCarousel({ selector, itemWidth, pauseFor, slideFor = 0.6 }: CarouselOpts): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let slide: ReturnType<typeof setTimeout> | undefined;

  requestIdleCallbackSafe(() => {
    const el = document.querySelector<HTMLElement>(selector)!;
    if (!el) return;
    const track = el.querySelector<HTMLElement>('.carousel__track')!;

    onResize();
    el.style.visibility = 'visible';
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
        kids.forEach(k => (k.style.transition = `transform ${slideFor}s ease`));
        kids.forEach(k => (k.style.transform = `translateX(-${itemW + gap}px)`));
        slide = setTimeout(() => {
          track.append(track.firstChild!);
          fix(false);
        }, slideFor * 1000);
      };
      $(el)
        .off('click.carousel')
        .on('click.carousel', '.carousel__prev', () => {
          track.prepend(track.lastChild!);
          fix();
        })
        .on('click.carousel', '.carousel__next', () => {
          track.append(track.firstChild!);
          fix();
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
