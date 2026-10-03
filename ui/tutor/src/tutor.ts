import { mountViewer } from '@lixiangqi/viewer';

site.load.then(() => {
  $('.tutor-card--link').on('click', function (this: HTMLElement) {
    const href = this.dataset['href'];
    if (href) site.redirect(href);
  });

  $('.tutor__opening .lpv').each(function (this: HTMLElement) {
    void mountViewer(
      this,
      { pgn: this.dataset.pgn },
      {
        orientation: this.dataset.orientation === 'black' ? 'black' : 'red',
        initialPly: 'last',
        showMoves: false,
      },
    );
  });

  const tutorUser = $('.tutor__waiting__games').data('tutor-user');
  const waitingGames = Array.from($('.tutor__waiting-game')),
    nbWaitingGames = waitingGames.length;
  if (tutorUser && nbWaitingGames) {
    setTimeout(() => location.assign(`/tutor/${tutorUser}?waiting=1`), 60 * 1000);

    waitingGames.forEach((el: HTMLElement, index: number) => {
      void mountViewer(
        el,
        { pgn: el.dataset.pgn },
        {
          orientation: el.dataset.pov === 'black' ? 'black' : 'red',
          initialPly: Math.max(0, 5 - index),
          showMoves: false,
          showControls: false,
        },
      ).then(viewer => {
        const interval = setInterval(() => viewer.navigate('next'), 500);
        window.addEventListener(
          'pagehide',
          () => {
            clearInterval(interval);
            viewer.destroy();
          },
          { once: true },
        );
      });
    });
  }
});
