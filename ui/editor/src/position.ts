import {
  boardDefinition,
  positionFromFen,
  positionToFen,
  type BoardDefinition,
  type BoardPosition,
} from '@lixiangqi/board';
import { loadRules, type Rules } from 'threeKingdoms';

import { banqiInventory } from 'lib/game/banqi';
import { requestXiangqi } from 'lib/game/xiangqiApi';

import { editorFen } from './fen';
import type { Color, Config, EditorVariant } from './interfaces';

export interface EditorPosition {
  readonly variant: EditorVariant;
  readonly definition: BoardDefinition;
  readonly startFen: string;
  read(fen: string): { fen: string; position: BoardPosition } | undefined;
  write(position: BoardPosition, previous: string, owners?: (Color | null)[]): string;
  owners?(fen: string): (Color | null)[];
  validate(fen: string, signal: AbortSignal): Promise<{ fen: string; playable: boolean }>;
}

export function rectangularPosition(cfg: Config): EditorPosition {
  const variant = cfg.variant ?? 'xiangqi';
  const definition = boardDefinition(variant === 'jieqi' ? 'xiangqi' : variant);
  return {
    variant,
    definition,
    startFen: cfg.startFen,
    read(raw) {
      const fen = editorFen(raw, variant);
      return fen ? { fen, position: positionFromFen(fen, definition) } : undefined;
    },
    write(position, previous) {
      if (variant === 'banqi') {
        const fields = previous.split(' ');
        const [placement, army] = positionToFen(position, definition).split(' ');
        const covers = [...placement].filter(c => c === '*').length;
        let available = banqiInventory;
        for (const c of placement) if (available.includes(c)) available = available.replace(c, '');
        let remaining = '';
        for (const c of fields[6])
          if (available.includes(c) && remaining.length < covers) {
            remaining += c;
            available = available.replace(c, '');
          }
        remaining += available.slice(0, covers - remaining.length);
        const assigned = covers === 32 ? '-' : fields[3] === '-' ? 'r' : fields[3];
        const seat = (army === 'w') !== (assigned === 'b') ? 'w' : 'b';
        return [placement, seat, 'banqi', assigned, fields[4], fields[5], remaining || '-'].join(' ');
      }
      return `${positionToFen(position, definition)} ${previous.split(' ').slice(2).join(' ')}`;
    },
    async validate(fen, signal) {
      return requestXiangqi(`/editor/validate?variant=${variant}`, { fen }, signal);
    },
  };
}

export async function loadEditorPosition(cfg: Config): Promise<EditorPosition> {
  return cfg.variant === 'threeKingdoms' ? kingdomPosition(await loadRules()) : rectangularPosition(cfg);
}

export function kingdomPosition(rules: Rules): EditorPosition {
  return {
    variant: 'threeKingdoms',
    definition: boardDefinition('threeKingdoms'),
    startFen: rules.initial(),
    read(raw) {
      try {
        const state = rules.diagram(raw.trim());
        return {
          fen: state.position,
          position: {
            board: 'threeKingdoms',
            active: state.turn,
            pieces: new Map(
              state.pieces.map(p => [
                p.location,
                {
                  face: 'up',
                  participant: p.army,
                  role: p.role,
                  controller: p.controller,
                  inactive: p.fallen,
                },
              ]),
            ),
          },
        };
      } catch {
        return undefined;
      }
    },
    write(position, previous, owners) {
      return rules.editDiagram(
        previous,
        [...position.pieces].map(([location, p]) => {
          if (p.face !== 'up') throw new Error('Three Kingdoms pieces must be visible');
          return { location, army: p.participant as Color, role: p.role };
        }),
        position.active,
        owners ?? rules.diagram(previous).controllers,
      );
    },
    owners: fen => rules.diagram(fen).controllers,
    async validate(fen) {
      // The compiled Scala rules are shared with the server; editing needs no server computation.
      try {
        const valid = rules.validateDiagram(fen);
        const state = rules.inspect(valid);
        return { fen: valid, playable: !state.ending && state.moves.length > 0 };
      } catch {
        throw new InvalidPosition();
      }
    },
  };
}

export class InvalidPosition extends Error {}
