export function initCarousel() {
  document.querySelectorAll<HTMLElement>('.lobby__blog').forEach(carousel => {
    const track = carousel.querySelector<HTMLElement>('.carousel__track')!;
    const previous = carousel.querySelector<HTMLButtonElement>('.carousel__prev')!;
    const next = carousel.querySelector<HTMLButtonElement>('.carousel__next')!;
    const update = () => {
      previous.disabled = track.scrollLeft <= 1;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    };
    previous.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth }));
    next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth }));
    track.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(track);
    update();
  });
}
