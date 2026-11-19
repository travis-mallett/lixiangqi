class Scroller {
  enabled = false;
  element?: HTMLElement;
  marker?: HTMLElement;

  private resize?: ResizeObserver;

  init = (el: HTMLElement) => {
    this.element = el;
    this.enabled = true;
    this.marker = undefined;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    this.resize = new ResizeObserver(this.auto);
    this.resize.observe(el);
    this.resize.observe(el.querySelector('.msg-app__convo__msgs__content')!);
  };
  destroy = () => {
    this.element?.removeEventListener('scroll', this.onScroll);
    this.resize?.disconnect();
    this.element = undefined;
    this.marker = undefined;
  };
  private onScroll = () => {
    const el = this.element;
    if (el) this.enabled = el.clientHeight + el.scrollTop >= el.scrollHeight - 20;
  };
  auto = () => {
    const el = this.element;
    if (el && this.enabled) el.scrollTop = el.scrollHeight;
  };
  followNewest = () => {
    this.marker = undefined;
    this.enabled = true;
  };
  setMarker = () => {
    this.marker = this.element?.querySelector('.msg-row') as HTMLElement;
  };
  toMarker = (): boolean => {
    if (this.marker && this.to(this.marker)) {
      this.marker = undefined;
      return true;
    }
    return false;
  };
  to = (target: HTMLElement) => {
    if (this.element) {
      const top = target.offsetTop - this.element.offsetHeight / 2 + target.offsetHeight / 2;
      if (top > 0) this.element.scrollTop = top;
      return top > 0;
    }
    return false;
  };
}

export const scroller = new Scroller();
