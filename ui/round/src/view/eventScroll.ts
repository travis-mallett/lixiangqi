import type { VNode } from 'lib/view';

export function scrollSelectedEvent(vnode: VNode): void {
  requestAnimationFrame(() => {
    const list = vnode.elm as HTMLElement;
    const selected = list.querySelector<HTMLElement>('.a1t');
    if (!selected) {
      list.scrollTop = list.scrollLeft = 0;
      return;
    }
    const outer = list.getBoundingClientRect();
    const inner = selected.getBoundingClientRect();
    const top = outer.top + list.clientTop;
    const left = outer.left + list.clientLeft;
    const bottom = top + list.clientHeight;
    const right = left + list.clientWidth;
    if (inner.top < top) list.scrollTop += inner.top - top;
    else if (inner.bottom > bottom) list.scrollTop += inner.bottom - bottom;
    if (inner.left < left) list.scrollLeft += inner.left - left;
    else if (inner.right > right) list.scrollLeft += inner.right - right;
  });
}
