import { licon } from 'lib/licon';
import { type VNode, type MaybeVNodes, bind, hl, icon } from 'lib/view';

import type PuzzleCtrl from '../ctrl';

const renderVote = (ctrl: PuzzleCtrl): VNode =>
  hl(
    'div.puzzle__vote',
    !ctrl.autoNexting() && [
      ctrl.session.isNew() &&
        ctrl.data.user?.provisional &&
        hl('div.puzzle__vote__help', i18n.puzzle.didYouLikeThisPuzzle),
      hl('div.puzzle__vote__buttons', [
        hl('button.button.button-empty.vote-up', {
          class: { active: ctrl.voted === true },
          attrs: { title: i18n.puzzle.upVote },
          hook: bind('click', () => ctrl.vote(true)),
        }),
        hl('button.button.button-empty.vote-down', {
          class: { active: ctrl.voted === false },
          attrs: { title: i18n.puzzle.downVote },
          hook: bind('click', () => ctrl.vote(false)),
        }),
      ]),
    ],
  );

const renderStreak = (ctrl: PuzzleCtrl): MaybeVNodes => [
  hl('div.complete', [
    hl('span.game-over', 'GAME OVER'),
    hl('span', i18n.puzzle.yourStreakX.asArray(hl('strong', `${ctrl.streak?.data.index ?? 0}`))),
  ]),
  hl('a.continue', { attrs: { href: ctrl.routerWithLang('/streak') } }, [
    icon(licon.PlayTriangle)(),
    i18n.puzzle.newStreak,
  ]),
];

export default function (ctrl: PuzzleCtrl): VNode {
  const { data } = ctrl;
  const win = ctrl.lastFeedback === 'win';
  return hl(
    'div.puzzle__feedback.after',
    ctrl.streak && !win
      ? renderStreak(ctrl)
      : [
          hl('div.complete', win ? ctrl.solvedMessage() : i18n.puzzle.puzzleComplete),
          hl('div.puzzle__more', [data.user ? renderVote(ctrl) : undefined]),
        ],
  );
}
