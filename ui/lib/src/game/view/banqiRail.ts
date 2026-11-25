import { hl, type VNode } from '../../view/snabbdom';
import { armyOfSeat, banqiInventory, type Army } from '../banqi';
import { jieqiRoleName } from './reveal';

const roles = ['general', 'advisor', 'elephant', 'chariot', 'horse', 'cannon', 'soldier'];
const letters = 'kabrncp';

export function banqiRail(
  fen: string,
  bottom: Army,
  upper: boolean,
  assetUrl: (path: string) => string = site.asset.url,
): VNode {
  const [placement, , , assignment, , , bag] = fen.split(' ');
  const army = armyOfSeat(fen, upper ? bottom : bottom === 'red' ? 'black' : 'red');
  const indexes = upper ? [0, 1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1, 0];
  return hl(
    'div.banqi-rail.' + (upper ? 'banqi-rail--upper' : 'banqi-rail--lower'),
    {
      attrs: { role: 'list', 'aria-label': i18n.site.capturedPieces },
    },
    indexes.map(i => {
      const symbol = army === 'red' ? letters[i].toUpperCase() : letters[i];
      const total = [...banqiInventory].filter(p => p === symbol).length;
      const count = Math.max(0, total - [...(placement + bag)].filter(p => p === symbol).length);
      const label = i18n.site.banqiCaptured(i18n.site[army], jieqiRoleName(roles[i]), count, total);
      return hl(
        'span.banqi-rail__slot',
        {
          key: symbol,
          attrs: {
            role: 'listitem',
            'aria-label': label,
            title: label,
            'data-victim': symbol,
            'data-count': count,
          },
        },
        [
          count
            ? hl(`piece.${letters[i]}-piece.${army === 'red' ? 'white' : 'black'}`)
            : hl('img.banqi-rail__engraving', {
                attrs: {
                  'aria-hidden': 'true',
                  alt: '',
                  src: assetUrl(
                    'piece/default-wood/rail/' +
                      (assignment === '-' || army === 'black' ? 'b' : 'r') +
                      letters[i].toUpperCase() +
                      '.svg',
                  ),
                },
              }),
          count > 1 && hl('span.banqi-rail__badge', String(count)),
        ],
      );
    }),
  );
}

export function banqiSeatLabel(fen: string, seat: Army): string {
  const whose = seat === 'red' ? i18n.site.banqiFirstSeat : i18n.site.banqiSecondSeat;
  return fen.split(' ')[3] === '-' ? whose : i18n.site.banqiArmy(whose, i18n.site[armyOfSeat(fen, seat)]);
}

export function banqiTurn(fen: string): string {
  const [, seat, , assigned, quiet] = fen.split(' ');
  const label = banqiSeatLabel(fen, seat === 'w' ? 'red' : 'black');
  const turn = assigned === '-' ? i18n.site.banqiSeatTurn(label) : label;
  return turn + ' · ' + i18n.site.banqiQuietCount(quiet);
}
