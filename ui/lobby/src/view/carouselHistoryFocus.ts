const historyKey = 'lobbyCarouselKeyboardReturn';

type ReturnTarget = { selector: string; href: string };

// Install before idle initialization so early user input cancels delayed restoration.
export function carouselHistoryFocus(
  selector: string,
): (el: HTMLElement, reveal: (link: HTMLAnchorElement) => void) => void {
  let interacted = false;
  let ready: (() => void) | undefined;
  let historyReturn =
    (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ===
    'back_forward';

  const clear = () => {
    const state = window.history.state;
    if (!state || typeof state !== 'object' || !(historyKey in state)) return;
    const { [historyKey]: _target, ...rest } = state;
    window.history.replaceState(rest, '');
  };
  document.addEventListener('keydown', () => (interacted = true), true);
  document.addEventListener('pointerdown', () => (interacted = true), true);
  window.addEventListener('pagehide', () => {
    interacted = false;
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    historyReturn = true;
    ready?.();
  });

  return (el: HTMLElement, reveal: (link: HTMLAnchorElement) => void): void => {
    const track = el.querySelector<HTMLElement>('.carousel__track')!;
    el.addEventListener('click', event => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      // A later pointer activation must not reuse a previous keyboard return target.
      clear();
      if (event.detail !== 0 || !(event.target instanceof window.Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (
        !link ||
        link.parentElement !== track ||
        link.hasAttribute('download') ||
        (link.target && link.target !== '_self')
      )
        return;
      const bounds = link.getBoundingClientRect();
      const viewport = el.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.right <= viewport.left || bounds.left >= viewport.right) return;
      const state = window.history.state;
      if (state !== null && (typeof state !== 'object' || Array.isArray(state))) return;
      window.history.replaceState(
        { ...state, [historyKey]: { selector, href: link.getAttribute('href')! } },
        '',
      );
    });

    ready = () => {
      if (!historyReturn) {
        clear();
        return;
      }
      historyReturn = false;
      const target = window.history.state?.[historyKey] as ReturnTarget | undefined;
      if (!target || target.selector !== selector) return;
      clear();
      if (interacted) return;
      const link = [...track.querySelectorAll<HTMLAnchorElement>('a[href]')].find(
        candidate => candidate.parentElement === track && candidate.getAttribute('href') === target.href,
      );
      if (!link) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement && active !== link)
        return;
      reveal(link);
      link.focus({ preventScroll: true });
    };
    ready();
  };
}
