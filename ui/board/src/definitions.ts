import threePlayerGeometry from './three-player-geometry.json' with { type: 'json' };
import type {
  BoardDefinition,
  BoardPresentation,
  Participant,
  RectangularGeometry,
  GraphGeometry,
  Location,
  VisiblePiece,
  GraphCoordinate,
} from './types';

export const standardXiangqi: BoardDefinition<RectangularGeometry> = Object.freeze({
  id: 'xiangqi',
  geometry: Object.freeze({
    id: 'xiangqi-9x10',
    columns: 9,
    rows: 10,
    placement: 'intersections' as const,
    frame: Object.freeze({ cellSize: 98, marginX: 58, marginY: 59 }),
  }),
  participants: ['red', 'black'] as const,
  roles: Object.freeze({
    general: 'k',
    advisor: 'a',
    elephant: 'b',
    horse: 'n',
    chariot: 'r',
    cannon: 'c',
    soldier: 'p',
  }),
  royalRoles: ['general'],
  coordinates: 'xiangqi' as const,
  coordinateImage: 'images/board/svg/xiangqi-file-coordinates.svg',
});

export const manchu: BoardDefinition<RectangularGeometry> = Object.freeze({
  ...standardXiangqi,
  id: 'manchu',
  pieceFamily: 'xiangqi',
  roles: Object.freeze({ ...standardXiangqi.roles, banner: 'm' }),
});

export const miniXiangqi: BoardDefinition<RectangularGeometry> = Object.freeze({
  ...standardXiangqi,
  id: 'minixiangqi',
  pieceFamily: 'xiangqi',
  coordinateImage: 'images/board/svg/minixiangqi-file-coordinates.svg',
  geometry: Object.freeze({
    id: 'minixiangqi-7x7',
    columns: 7,
    rows: 7,
    placement: 'intersections' as const,
    frame: Object.freeze({ cellSize: 98, marginX: 56, marginY: 56 }),
  }),
  roles: Object.freeze({ general: 'k', horse: 'n', chariot: 'r', cannon: 'c', soldier: 'p' }),
});

export const threeKingdoms: BoardDefinition<GraphGeometry> = Object.freeze({
  ...standardXiangqi,
  id: 'threeKingdoms',
  pieceFamily: 'threeKingdoms',
  participants: ['red', 'black', 'green'],
  coordinateImage: undefined,
  pieceRotation: (location: Location, piece: VisiblePiece) => {
    const territories: Record<string, 'red' | 'black' | 'green'> = { wei: 'black', shu: 'red', wu: 'green' };
    const [region, file] = location.split(':');
    const territory = territories[region];
    if (!territory) throw new Error('Unknown Three Kingdoms territory');
    const points: Record<string, readonly number[]> = threePlayerGeometry.locations;
    const bottom = points[`${region}:${file}:0`];
    const forward = points[`${region}:${file}:1`];
    if (!bottom || !forward) throw new Error('Unknown Three Kingdoms file');
    // Follow the local file's skew. Across a river, invading armies point toward
    // the defending army's bottom rank instead of back toward the river.
    const angle = (Math.atan2(forward[0] - bottom[0], bottom[1] - forward[1]) * 180) / Math.PI;
    return angle + (piece.participant === territory ? 0 : 180);
  },
  geometry: Object.freeze({
    ...threePlayerGeometry,
    kind: 'graph' as const,
    placement: 'intersections' as const,
    coordinates: Object.freeze(threePlayerCoordinates()),
    territoryAnchors: Object.freeze(
      Object.fromEntries(
        [
          ['black', 'wei'],
          ['green', 'wu'],
          ['red', 'shu'],
        ].map(([color, kingdom]) => {
          const palace =
            threePlayerGeometry.locations[`${kingdom}:4:1` as keyof typeof threePlayerGeometry.locations];
          return [
            color,
            [
              (palace[0] + threePlayerGeometry.width / 2) / 2,
              (palace[1] + threePlayerGeometry.height / 2) / 2,
            ] as const,
          ];
        }),
      ),
    ),
    riverAnchors: Object.freeze(
      Object.fromEntries(
        [
          ['black', 'wei', 'green', 'wu'],
          ['black', 'wei', 'red', 'shu'],
          ['green', 'wu', 'red', 'shu'],
        ].map(([a, ak, b, bk]) => {
          const points = threePlayerGeometry.locations as Record<string, number[]>;
          const x = (points[`${ak}:4:1`][0] + points[`${bk}:4:1`][0]) / 2 - threePlayerGeometry.width / 2;
          const y = (points[`${ak}:4:1`][1] + points[`${bk}:4:1`][1]) / 2 - threePlayerGeometry.height / 2;
          const radius = (threePlayerGeometry.height / 2 - 59) * 0.535;
          const length = Math.hypot(x, y);
          return [
            [a, b].sort().join(':'),
            [
              threePlayerGeometry.width / 2 + (radius * x) / length,
              threePlayerGeometry.height / 2 + (radius * y) / length,
            ] as const,
          ];
        }),
      ),
    ),
    locations: Object.freeze(
      Object.fromEntries(
        Object.entries(threePlayerGeometry.locations).map(([location, point]) => [
          location,
          Object.freeze(point) as readonly [number, number],
        ]),
      ),
    ),
  }),
});

function threePlayerCoordinates(): GraphCoordinate[] {
  const points: Record<string, readonly number[]> = threePlayerGeometry.locations;
  return (
    [
      ['shu', 'red', 'E'],
      ['wu', 'green', 'J'],
      ['wei', 'black', 'O'],
    ] as const
  ).flatMap(([region, color, backRank]) => {
    const angle = (-threePlayerGeometry.rotations[color] * Math.PI) / 180;
    const label = (
      location: string,
      text: string,
      axis: 'file' | 'rank',
      dx: number,
      dy: number,
    ): GraphCoordinate => {
      const [x, y] = points[location];
      return {
        location,
        text,
        axis,
        point: [
          x + dx * Math.cos(angle) - dy * Math.sin(angle),
          y + dx * Math.sin(angle) + dy * Math.cos(angle),
        ],
      };
    };
    return [
      ...Array.from({ length: 9 }, (_, file) =>
        label(`${region}:${file}:0`, String(file + 1), 'file', 0, 82),
      ),
      ...Array.from({ length: 5 }, (_, rank) =>
        label(`${region}:0:${rank}`, String.fromCharCode(backRank.charCodeAt(0) - rank), 'rank', -71, 41),
      ),
    ];
  });
}

export const supportedBoards: readonly BoardDefinition[] = [
  standardXiangqi,
  miniXiangqi,
  manchu,
  threeKingdoms,
];

/** Native FEN geometry determines the board; positionFromFen validates the entire placement. */
export function boardDefinitionForFen(fen: string): BoardDefinition<RectangularGeometry> {
  const [placement, , variant] = fen.trim().split(/\s+/);
  if (placement.split('/').length === 7) return miniXiangqi;
  return variant === 'm' || /m/i.test(placement) ? manchu : standardXiangqi;
}

export function boardDefinition(id: string): BoardDefinition {
  const definition = supportedBoards.find(board => board.id === id);
  if (!definition) throw new Error(`Unsupported board: ${id}`);
  return definition;
}

export type BoardPurpose = 'interactive' | 'replay' | 'editor' | 'thumbnail' | 'preview';

export function boardPresentation(purpose: BoardPurpose, perspective: Participant): BoardPresentation {
  const quiet = purpose === 'thumbnail' || purpose === 'preview' || purpose === 'editor';
  return {
    perspective,
    coordinates: purpose !== 'thumbnail' && purpose !== 'preview',
    highlight: purpose !== 'editor',
    motion: { duration: purpose === 'preview' ? 0 : 200 },
    feedback: { effects: quiet ? [] : ['capture', 'check', 'checkmate'], audio: !quiet },
    drawing: purpose === 'interactive' || purpose === 'replay' || purpose === 'editor',
  };
}
