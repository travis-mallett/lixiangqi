site.load.then(() => {
  document.querySelectorAll<HTMLElement>('.video-section__carousel').forEach(carousel => {
    const row = carousel.querySelector<HTMLElement>('.video-section__videos')!;
    const previous = carousel.querySelector<HTMLButtonElement>('.video-section__previous')!;
    const next = carousel.querySelector<HTMLButtonElement>('.video-section__next')!;
    const update = () => {
      previous.hidden = row.scrollLeft <= 1;
      next.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
    };
    const advance = (direction: number) =>
      row.scrollBy({
        left: direction * (row.clientWidth + parseFloat(window.getComputedStyle(row).columnGap)),
      });
    previous.addEventListener('click', () => advance(-1));
    next.addEventListener('click', () => advance(1));
    row.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(row);
    update();
  });
});
