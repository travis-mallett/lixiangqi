const dragThreshold = 6;

export const bindMouseDragging = (track: HTMLElement) => {
  let pointerId: number | undefined;
  let startX = 0;
  let startScrollLeft = 0;
  let dragged = false;

  track.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startScrollLeft = track.scrollLeft;
    dragged = false;
  });

  track.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    const distance = event.clientX - startX;
    if (!dragged && Math.abs(distance) < dragThreshold) return;
    if (!dragged) {
      dragged = true;
      track.classList.add('is-dragging');
      track.setPointerCapture(event.pointerId);
    }
    track.scrollLeft = startScrollLeft - distance;
    event.preventDefault();
  });

  const finishDragging = (event: PointerEvent, cancelled: boolean) => {
    if (event.pointerId !== pointerId) return;
    if (track.hasPointerCapture(pointerId)) track.releasePointerCapture(pointerId);
    pointerId = undefined;
    track.classList.remove('is-dragging');
    if (cancelled) dragged = false;
    else if (dragged) window.setTimeout(() => (dragged = false));
  };

  track.addEventListener('pointerup', event => finishDragging(event, false));
  track.addEventListener('pointercancel', event => finishDragging(event, true));
  track.addEventListener('dragstart', event => event.preventDefault());
  track.addEventListener(
    'click',
    event => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
};
