import { debounce } from 'lib/async';
import { pubsub } from 'lib/pubsub';
import { text } from 'lib/xhr';

export function initModule(): void {
  directoryPlayerFollow();
  pubsub.on('content-loaded', directoryPlayerFollow);
}

function directoryPlayerFollow(el?: HTMLElement): void {
  (el || document.body)
    .querySelectorAll<HTMLInputElement>('.directory-player__follow input:not(.loaded)')
    .forEach(el => {
      el.addEventListener(
        'change',
        debounce(
          e =>
            text(
              $(e.target)
                .data('action')
                .replace(/follow=[^&]+/, `follow=${$(e.target).prop('checked')}`),
              { method: 'post' },
            ),
          1000,
          true,
        ),
      );
      el.classList.add('loaded');
    });
}
