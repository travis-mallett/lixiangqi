import { getBoard } from 'lib/view';
import * as xhr from 'lib/xhr';

function init() {
  let failed = false;

  $('div.captcha').each(function (this: HTMLElement) {
    if (this.dataset.initialized) return;

    const $captcha = $(this),
      $board = $captcha.find('.mini-board'),
      $input = $captcha.find('input').val(''),
      board = getBoard($board[0]!);
    if (!board) {
      failed = true;
      return;
    }

    $board.on('touchstart', () => {
      const el = document.activeElement as HTMLElement;
      if (el && 'blur' in el) el.blur();
    });

    const position = board.position();
    const destinations = new Map(Object.entries($board.data('moves') as Record<string, string[]>));
    const enable = () =>
      board.setInteraction({
        mode: 'play',
        participant: position.active,
        destinations,
        input: 'both',
        showDestinations: true,
        onMove: ({ from, to }) => {
          $captcha.removeClass('success failure');
          board.setInteraction({ mode: 'display' });
          submit(`${from} ${to}`);
        },
      });

    const submit = function (solution: string) {
      $input.val(solution);
      xhr.text(xhr.url($captcha.data('check-url'), { solution })).then(data => {
        $captcha.toggleClass('success', data === '1').toggleClass('failure', data !== '1');
        if (data !== '1')
          setTimeout(() => {
            board.display(position, { kind: 'correction' });
            enable();
          }, 300);
      });
    };

    enable();
    this.dataset.initialized = '1';
  });

  if (failed) setTimeout(init, 1000);
}

site.load.then(() => setTimeout(init, 1000));
