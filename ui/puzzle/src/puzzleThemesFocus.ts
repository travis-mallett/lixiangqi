const focusRestoreKey = 'puzzle-themes-focus-href';

export function initPuzzleThemesFocus(page: HTMLElement): void {
  page.addEventListener('click', event => {
    if (!(event instanceof window.MouseEvent) || !(event.target instanceof window.Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a.puzzle-themes__link[href]');
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    try {
      sessionStorage.setItem(focusRestoreKey, link.getAttribute('href')!);
    } catch {
      // Browser storage may be unavailable; native history focus restoration remains in effect.
    }
  });
  window.addEventListener('pageshow', event => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (!event.persisted && navigation?.type !== 'back_forward') return;
    try {
      const href = sessionStorage.getItem(focusRestoreKey);
      if (!href) return;
      sessionStorage.removeItem(focusRestoreKey);
      const link = [...page.querySelectorAll<HTMLAnchorElement>('a.puzzle-themes__link[href]')].find(
        candidate => candidate.getAttribute('href') === href,
      );
      // Lessons also focus their summaries while restoring from BFCache. Restore the link after
      // those pageshow handlers have finished so the selected theme keeps focus.
      queueMicrotask(() => link?.focus({ preventScroll: true }));
    } catch {
      // Ignore unavailable browser storage and keep the browser's native restoration.
    }
  });
}
