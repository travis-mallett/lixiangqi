import { h, type VNode } from 'snabbdom';

export interface ProgressBar {
  /** Omit while the amount of remaining work is unknown. */
  percent?: number;
  active: boolean;
  visible: boolean;
  label: string;
  threat?: boolean;
}

/** Shared by the DOM analysis widget and Snabbdom engine/puzzle widgets. */
export function updateProgressBar(element: HTMLElement, progress: ProgressBar): void {
  const span = element.firstElementChild as HTMLElement;
  const percent = progress.percent === undefined ? undefined : Math.max(0, Math.min(100, progress.percent));
  element.classList.add('engine-progress');
  element.classList.toggle('active', progress.active);
  element.classList.toggle('indeterminate', percent === undefined);
  element.hidden = !progress.visible;
  element.setAttribute('role', 'progressbar');
  element.setAttribute('aria-label', progress.label);
  element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', '100');
  if (percent === undefined) element.removeAttribute('aria-valuenow');
  else element.setAttribute('aria-valuenow', String(percent));
  const width = progress.visible ? (percent ?? 100) : 0;
  const threat = !!progress.threat;
  if (Number(span.dataset.percent) > width || span.classList.contains('threat') !== threat) {
    // Reset a completed line immediately when a new search/download begins.
    span.remove();
    element.append(span);
  }
  span.style.width = `${width}%`;
  span.dataset.percent = String(width);
  span.classList.toggle('threat', threat);
}

export function progressBar(progress: ProgressBar): VNode {
  return h(
    'div.bar.engine-progress',
    {
      hook: {
        insert: vnode => updateProgressBar(vnode.elm as HTMLElement, progress),
        postpatch: (_, vnode) => updateProgressBar(vnode.elm as HTMLElement, progress),
      },
    },
    [h('span')],
  );
}
