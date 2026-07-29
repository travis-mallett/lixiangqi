import { numberFormat } from 'lib/i18n';

interface AnimateNumber {
  duration: number;
  render: (n: number) => string;
}
export const animateNumber = (counter: HTMLElement, opts: Partial<AnimateNumber>): void => {
  const o: AnimateNumber = { duration: 1500, render: numberFormat, ...opts };
  const value = parseInt(counter.dataset['value'] || '0');
  const startAt = performance.now();
  const stopAt = startAt + o.duration;
  const animate = () => {
    const now = performance.now();
    if (now >= stopAt) counter.innerHTML = o.render(value);
    else {
      const elapsed = now - startAt;
      const ratio = elapsed / o.duration;
      const current = Math.ceil(value * ratio);
      counter.innerHTML = o.render(Math.ceil(current));
      requestAnimationFrame(animate);
    }
  };
  animate();
};
