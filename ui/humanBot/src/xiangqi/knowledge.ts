import { clamp } from '../random';
import type {
  Appraisal,
  Belief,
  Binding,
  KnowledgeManifest,
  KnowledgePack,
  Move,
  Observation,
  Piece,
  Plan,
  Player,
  Question,
  Schema,
} from '../types';
import { coordinates } from './rules';

const provenance = 'LiXiangQi authored relational curriculum; synthetic, no human-game frequencies';
type SchemaRow = readonly [string, string, readonly string[], readonly string[], boolean, string];
const rows: readonly SchemaRow[] = [
  [
    'capture',
    'tactics',
    [],
    [],
    true,
    'Visible captures suggest a material gain; opponent resources remain unknown.',
  ],
  [
    'recapture',
    'tactics',
    ['capture'],
    [],
    true,
    'Challenge an exchange by inspecting the capturing piece and its reply.',
  ],
  [
    'rook-line',
    'geometry',
    ['capture'],
    ['chariot'],
    true,
    'Inspect unobstructed rook rays; changed blockers can invalidate a remembered line.',
  ],
  [
    'cannon-screen',
    'geometry',
    ['capture'],
    ['cannon'],
    true,
    'A cannon attack requires exactly one screen, established by canonical attack inspection.',
  ],
  [
    'horse-leg',
    'geometry',
    ['capture'],
    ['horse'],
    true,
    'Horse reach depends on the intermediate leg; destination proximity is only a cue.',
  ],
  [
    'elephant-eye',
    'geometry',
    ['capture'],
    ['elephant'],
    false,
    'Elephant eye obstruction and river restrictions come from exact geometry.',
  ],
  [
    'general-safety',
    'defense',
    ['capture'],
    ['general', 'advisor', 'elephant'],
    false,
    'Palace shelter and inspected escape threats guide defense.',
  ],
  [
    'facing-generals',
    'geometry',
    ['rook-line'],
    ['general', 'chariot'],
    true,
    'Changes on the central file invite a paid line inspection; legal filtering is always exact.',
  ],
  [
    'rook-activity',
    'strategy',
    ['rook-line'],
    ['chariot'],
    false,
    'Activate a rook using inspected reach and open ranks, with progress tracking.',
  ],
  [
    'cannon-pressure',
    'strategy',
    ['cannon-screen'],
    ['cannon'],
    false,
    'Use a viable screen and pressure, not a reward for merely owning a cannon.',
  ],
  [
    'horse-outpost',
    'strategy',
    ['horse-leg'],
    ['horse'],
    false,
    'Advance an unblocked horse toward useful central destinations.',
  ],
  [
    'soldier-advance',
    'strategy',
    ['capture'],
    ['soldier'],
    false,
    'Crossing the river changes activity; advance with a concrete progress goal.',
  ],
  [
    'rook-cannon',
    'coordination',
    ['rook-line', 'cannon-screen'],
    ['chariot', 'cannon'],
    true,
    'Combine inspected rook and cannon targets; alignment alone is a tempting near-match.',
  ],
  [
    'horse-cannon',
    'coordination',
    ['horse-leg', 'cannon-screen'],
    ['horse', 'cannon'],
    true,
    'Combine cannon pressure and a horse route after checking legs and screens.',
  ],
  [
    'double-rook',
    'coordination',
    ['rook-line'],
    ['chariot'],
    true,
    'Coordinate two rooks on inspected targets or complementary ranks.',
  ],
  [
    'screen-change',
    'tactics',
    ['cannon-screen'],
    [],
    true,
    'Consider moving a line-adjacent piece to create or remove a cannon screen.',
  ],
  [
    'unblock-horse',
    'tactics',
    ['horse-leg'],
    [],
    false,
    'Quietly move a neighboring blocker before committing the horse.',
  ],
  [
    'quiet-defense',
    'defense',
    ['general-safety'],
    [],
    false,
    'Consider retreats and shelter moves when a threat competes with an attractive attack.',
  ],
  [
    'exchange',
    'strategy',
    ['recapture'],
    [],
    true,
    'Trade active pieces only after a subjective exchange assessment.',
  ],
  [
    'blockade',
    'endgame',
    ['horse-leg', 'soldier-advance'],
    ['horse', 'soldier'],
    false,
    'Restrict advancing soldiers and require measured progress.',
  ],
  [
    'conversion',
    'endgame',
    ['rook-activity', 'general-safety'],
    ['chariot', 'soldier', 'general'],
    false,
    'Improve activity and constrain the palace without an automatic tablebase switch.',
  ],
  [
    'fortress',
    'endgame',
    ['general-safety', 'elephant-eye'],
    ['general', 'advisor', 'elephant'],
    false,
    'Preserve a defensive structure as a hypothesis, never declare a draw from material alone.',
  ],
  [
    'counterplay',
    'defense',
    ['rook-activity', 'cannon-pressure'],
    ['chariot', 'cannon', 'horse'],
    false,
    'Seek credible pressure in a worse position instead of a universal resignation cutoff.',
  ],
  [
    'rule-consequences',
    'rules',
    ['capture'],
    [],
    false,
    'Attend public repetition pressure; exact policy still owns restrictions and endings.',
  ],
  [
    'opening-development',
    'opening',
    ['horse-leg', 'cannon-screen', 'rook-line'],
    ['horse', 'cannon', 'chariot'],
    false,
    'Authored opening branches and formation transfer with distinct recall and understanding.',
  ],
];
const schemas: readonly Schema[] = rows.map(([id, family, prerequisites, roles, forcing, description]) => ({
  id,
  family,
  prerequisites,
  roles,
  forcing,
  description,
  provenance,
}));
export const XIANGQI_MANIFEST: KnowledgeManifest = {
  version: 'xiangqi-authored-2',
  variant: 'xiangqi',
  schemas,
  openings: [
    {
      id: 'central-cannon',
      players: ['red', 'black'],
      description: 'Central cannon, develop a horse, activate a rook; exit when the formation disappears.',
    },
    {
      id: 'screen-horses',
      players: ['red', 'black'],
      description: 'Develop both horses and preserve a flexible cannon structure.',
    },
    {
      id: 'elephant-formation',
      players: ['red', 'black'],
      description: 'Build elephant shelter, then develop a horse and active pieces.',
    },
  ],
  roles: ['active-rook', 'cannon-pressure', 'horse-blockade', 'soldier-space', 'palace-defense'],
};
/** Authored legal continuations, not a move-frequency book. Last move is the recalled action. */
export const OPENING_BRANCHES: Readonly<
  Record<string, Readonly<Record<string, readonly (readonly string[])[]>>>
> = {
  red: {
    'central-cannon': [['h3e3'], ['h3e3', 'h10g8', 'h1g3'], ['h3e3', 'h10g8', 'h1g3', 'b10c8', 'i1h1']],
    'screen-horses': [['h1g3'], ['h1g3', 'h8e8', 'b1c3'], ['h1g3', 'h8e8', 'b1c3', 'h10g8', 'i1h1']],
    'elephant-formation': [['c1e3'], ['c1e3', 'h8e8', 'h1g3'], ['c1e3', 'h8e8', 'h1g3', 'h10g8', 'i1h1']],
  },
  black: {
    'central-cannon': [
      ['h1g3', 'h8e8'],
      ['c1e3', 'h8e8'],
      ['h1g3', 'h8e8', 'b1c3', 'h10g8'],
    ],
    'screen-horses': [
      ['h3e3', 'h10g8'],
      ['h3e3', 'h10g8', 'h1g3', 'b10c8'],
    ],
    'elephant-formation': [
      ['h1g3', 'c10e8'],
      ['c1e3', 'c10e8'],
    ],
  },
};
const values: Readonly<Record<string, number>> = {
  general: 0,
  advisor: 2,
  elephant: 2,
  horse: 4,
  chariot: 9,
  cannon: 4.5,
  soldier: 1,
};
const schemaForRole: Readonly<Record<string, string>> = {
  general: 'general-safety',
  advisor: 'general-safety',
  elephant: 'elephant-eye',
  horse: 'horse-leg',
  chariot: 'rook-line',
  cannon: 'cannon-screen',
  soldier: 'soldier-advance',
};
const roleFeature: Readonly<Record<string, string>> = {
  general: 'palace-defense',
  advisor: 'palace-defense',
  elephant: 'palace-defense',
  horse: 'horse-blockade',
  chariot: 'active-rook',
  cannon: 'cannon-pressure',
  soldier: 'soldier-space',
};
function progress(piece: Piece): number {
  return piece.owner === 'red' ? (piece.y! - 1) / 9 : (10 - piece.y!) / 9;
}
function distance(a: Piece, b: Piece): number {
  return (Math.abs(a.x! - b.x!) + Math.abs(a.y! - b.y!)) / 17;
}
function forward(move: Move, player: Player): boolean {
  return (coordinates(move.to!)[1] - coordinates(move.from!)[1]) * (player === 'red' ? 1 : -1) > 0;
}

export class XiangqiKnowledge implements KnowledgePack {
  readonly manifest: KnowledgeManifest = XIANGQI_MANIFEST;
  moveCues(
    observation: Observation,
    move: Move,
    known: readonly string[],
  ): { defensive: number; material: number; recapture: number } {
    return {
      // A defensive piece is not automatically a defensive move. The old role
      // bonus made high quiet/defensive attention prefer idle palace shuffles.
      // Checked status is a public cue; other threat judgments need inspection.
      defensive: Number(observation.checked.includes(move.actor)),
      material: move.captureRole ? values[move.captureRole] / 9 : 0,
      recapture: move.capture && move.to === observation.lastMove?.to && known.includes('recapture') ? 1 : 0,
    };
  }
  bindings(observation: Observation, player: Player): readonly Binding[] {
    const own = observation.pieces.filter(p => p.owner === player);
    const moves = observation.turn === player ? observation.moves : [];
    const result: Binding[] = [];
    const lowMaterial =
      observation.pieces.filter(p => ['chariot', 'horse', 'cannon'].includes(p.role)).length <= 6;
    for (const schema of schemas) {
      if (schema.family === 'endgame' && !lowMaterial) continue;
      if (schema.family === 'opening') continue;
      const relevant = schema.roles.length ? own.filter(p => schema.roles.includes(p.role)) : own;
      if (!relevant.length) continue;
      let suggested = moves.filter(m => !schema.roles.length || schema.roles.includes(m.role!));
      if (['capture', 'recapture', 'exchange'].includes(schema.id))
        suggested = suggested.filter(m => m.capture);
      if (schema.id === 'recapture')
        suggested = suggested.filter(
          m => m.to === observation.lastMove?.to && !!observation.lastMove?.capture,
        );
      if (schema.id === 'quiet-defense')
        suggested = suggested.filter(
          m => !m.capture && (!forward(m, player) || ['advisor', 'elephant', 'general'].includes(m.role!)),
        );
      if (schema.id === 'screen-change') {
        const cannons = observation.pieces.filter(p => p.role === 'cannon');
        suggested = suggested.filter(m =>
          cannons.some(p => p.x === coordinates(m.from!)[0] || p.y === coordinates(m.from!)[1]),
        );
      }
      if (schema.id === 'unblock-horse') {
        const horses = own.filter(p => p.role === 'horse');
        suggested = suggested.filter(m =>
          horses.some(
            p => Math.abs(p.x! - coordinates(m.from!)[0]) + Math.abs(p.y! - coordinates(m.from!)[1]) === 1,
          ),
        );
      }
      if (['horse-outpost', 'soldier-advance', 'conversion'].includes(schema.id))
        suggested = suggested.filter(m => forward(m, player));
      if (
        !suggested.length &&
        ['capture', 'recapture', 'exchange', 'screen-change', 'unblock-horse'].includes(schema.id)
      )
        continue;
      if (schema.id === 'double-rook' && own.filter(p => p.role === 'chariot').length < 2) continue;
      if (schema.id === 'rook-cannon' && !own.some(p => p.role === 'chariot')) continue;
      if (schema.id === 'horse-cannon' && !own.some(p => p.role === 'horse')) continue;
      const subjects =
        schema.id === 'screen-change' ? observation.pieces.filter(p => p.role === 'cannon') : relevant;
      const recaptureCue =
        schema.id === 'recapture' &&
        observation.lastMove?.capture &&
        suggested.some(m => m.to === observation.lastMove!.to);
      result.push({
        schema: schema.id,
        key: `${schema.id}/${player}`,
        cue: recaptureCue
          ? 1.4
          : observation.checked.includes(player) && schema.family === 'defense'
            ? 1
            : suggested.some(m => m.capture)
              ? 0.8
              : 0.45,
        similarity: schema.family === 'coordination' ? 0.65 : 1,
        actions: suggested.map(m => m.action),
        questions: subjects.map(p => `attacks/${p.id}`),
        goal: `${schema.id}/${player}`,
        role: schema.roles[0],
        progress: relevant.reduce((sum, p) => sum + progress(p), 0) / relevant.length,
        forcing: schema.forcing && (!!recaptureCue || observation.checked.includes(player)),
      });
    }
    const mirror = (square: string): string => `${square[0]}${11 - Number(square.slice(1))}`;
    const cannonHome = player === 'red' ? 'h3' : 'h8',
      horseHome = player === 'red' ? 'h1' : 'h10';
    const familyMoves: Record<string, string[]> = {
      'central-cannon': [
        cannonHome + (player === 'red' ? 'e3' : 'e8'),
        horseHome + (player === 'red' ? 'g3' : 'g8'),
      ],
      'screen-horses': [horseHome + (player === 'red' ? 'g3' : 'g8'), player === 'red' ? 'b1c3' : 'b10c8'],
      'elephant-formation': [
        player === 'red' ? 'c1e3' : mirror('c1') + mirror('e3'),
        horseHome + (player === 'red' ? 'g3' : 'g8'),
      ],
    };
    // Formation preconditions, rather than a ply cutoff, terminate opening knowledge.
    const homePieces = own.filter(
      p =>
        (player === 'red' ? p.y! <= 3 : p.y! >= 8) &&
        ['horse', 'cannon', 'chariot', 'elephant'].includes(p.role),
    );
    if (homePieces.length >= 5)
      for (const [family, actions] of Object.entries(familyMoves)) {
        const branch = OPENING_BRANCHES[player]?.[family]?.find(
          line =>
            line.length === (observation.history?.length ?? -1) + 1 &&
            line.slice(0, -1).every((move, i) => move === observation.history![i]),
        );
        const legal = (branch ? [branch[branch.length - 1]] : actions).filter(a =>
          moves.some(m => m.action === a),
        );
        if (!legal.length) continue;
        const stage = branch ? Math.floor((branch.length - 1) / 2) : actions.indexOf(legal[0]);
        const exact = !!branch;
        result.push({
          schema: 'opening-development',
          key: `opening/${family}/${stage}`,
          cue: exact ? 1 : 0.65,
          similarity: exact ? 1 : 0.7,
          actions: legal,
          questions: homePieces.map(p => `attacks/${p.id}`),
          goal: `opening/${family}/${player}`,
          progress: 1 - homePieces.length / 8,
          forcing: false,
          recall: { family, extent: branch ? 0.1 + (branch.length - 1) * 0.18 : stage ? 0.55 : 0.1, exact },
        });
      }
    return result;
  }
  questions(observation: Observation, player: Player): readonly Question[] {
    const general = observation.pieces.find(p => p.owner === player && p.role === 'general');
    const focal = observation.pieces.find(p => p.location === observation.lastMove?.to);
    return [...observation.pieces]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(piece => ({
        id: `attacks/${piece.id}`,
        schema: schemaForRole[piece.role],
        kind: 'attacks',
        subject: piece.id,
        dependencies: ['*', piece.id],
        distance: Math.min(general ? distance(piece, general) : 1, focal ? distance(piece, focal) : 1),
        cost: piece.role === 'cannon' ? 1.4 : ['horse', 'elephant'].includes(piece.role) ? 1.2 : 1,
      }));
  }
  appraise(
    observation: Observation,
    beliefs: readonly Belief[],
    known: readonly string[],
    player: Player,
  ): Appraisal {
    const owns = new Set(known),
      byLocation = new Map(observation.pieces.map(p => [p.location, p]));
    const own = observation.pieces.filter(p => p.owner === player),
      others = observation.pieces.filter(p => p.owner !== player);
    const general = own.find(p => p.role === 'general'),
      enemyGeneral = others.find(p => p.role === 'general');
    const relation = new Map(beliefs.map(b => [b.subject, b]));
    const roleActivity: Record<string, number> = Object.fromEntries(
      this.manifest.roles.map(role => [role, 0]),
    );
    let material = 0,
      activity = 0,
      safety = 0,
      initiative = 0,
      structure = 0,
      prevention = 0,
      measured = 0;
    const totalAttackers = observation.pieces.filter(p =>
      ['chariot', 'horse', 'cannon'].includes(p.role),
    ).length;
    for (const piece of observation.pieces) {
      const sign = piece.owner === player ? 1 : -1;
      let value = values[piece.role];
      if (piece.role === 'soldier' && owns.has('soldier-advance') && progress(piece) > 0.5) value += 0.8;
      if (piece.role === 'cannon' && owns.has('cannon-pressure'))
        value *= 0.8 + Math.min(1, totalAttackers / 10) * 0.2;
      material += sign * value;
      const evidence = relation.get(piece.id);
      if (!evidence || !owns.has(schemaForRole[piece.role])) continue;
      measured++;
      const reach = evidence.targets.length;
      activity += sign * reach * 0.09;
      if (sign > 0) roleActivity[roleFeature[piece.role]] += Math.min(2, reach * 0.12);
      for (const target of evidence.targets) {
        const victim = byLocation.get(target);
        if (victim && victim.owner !== piece.owner) {
          // An attacked piece is not a lost piece. Geometry alone says nothing
          // about a recapture or the profitability of exchanging the attacker.
          // Keep this as modest pressure; searched transitions realize material.
          initiative += sign * Math.min(0.15, values[victim.role] * 0.02);
          if (victim.role === 'general') {
            safety += sign * 2.5;
            initiative += sign;
          }
        }
        const [x, y] = coordinates(target),
          king = sign > 0 ? enemyGeneral : general;
        if (king && Math.abs(x - king.x!) + Math.abs(y - king.y!) <= 1) {
          safety += sign * 0.18;
          if (sign < 0) prevention -= 0.15;
        }
      }
    }
    if (owns.has('general-safety') && general) {
      const shelter = own.filter(
        p => ['advisor', 'elephant'].includes(p.role) && distance(p, general) < 0.3,
      ).length;
      structure += shelter * 0.2;
      if (prevention < 0) prevention += shelter * Math.min(0.08, -prevention * 0.1);
    }
    if (owns.has('opening-development') && totalAttackers >= 9) {
      structure +=
        own.filter(p => p.role === 'horse' && progress(p) > 0.1 && p.x! >= 2 && p.x! <= 6).length * 0.65;
      structure += own.filter(p => p.role === 'cannon' && p.x === 4 && progress(p) < 0.5).length * 0.5;
      structure += own.filter(p => p.role === 'chariot' && progress(p) > 0.05).length * 0.5;
    }
    if (owns.has('rook-cannon') || owns.has('horse-cannon') || owns.has('double-rook')) {
      const attackers = own.filter(
        p => ['chariot', 'cannon', 'horse'].includes(p.role) && relation.has(p.id),
      );
      for (let i = 0; i < attackers.length; i++)
        for (let j = i + 1; j < attackers.length; j++) {
          const left = attackers[i],
            right = attackers[j];
          const combined = [left.role, right.role].sort().join('/');
          const recognized =
            (combined === 'cannon/chariot' && owns.has('rook-cannon')) ||
            (combined === 'cannon/horse' && owns.has('horse-cannon')) ||
            (combined === 'chariot/chariot' && owns.has('double-rook'));
          if (recognized)
            initiative +=
              relation
                .get(left.id)!
                .targets.filter(
                  t => relation.get(right.id)!.targets.includes(t) && byLocation.get(t)?.owner !== player,
                ).length * 0.2;
        }
    }
    if (owns.has('blockade'))
      for (const horse of own.filter(p => p.role === 'horse')) {
        const targets = relation.get(horse.id)?.targets ?? [];
        prevention +=
          others.filter(
            p =>
              p.role === 'soldier' &&
              targets.includes(`${p.location[0]}${p.y! + (p.owner === 'red' ? 1 : -1)}`),
          ).length * 0.5;
      }
    if (owns.has('fortress') && totalAttackers <= 6 && general)
      structure +=
        own.filter(p => ['advisor', 'elephant'].includes(p.role) && distance(p, general) < 0.2).length * 0.2;
    if (owns.has('rule-consequences')) structure -= observation.rulePressure * (material > 0 ? 1.5 : 0.2);
    const confidence = clamp(
      0.2 + (measured / Math.max(1, observation.pieces.length)) * 0.7 + known.length * 0.004,
    );
    return {
      terminal: observation.terminal?.[player],
      confidence,
      uncertainty: 1 - confidence,
      features: {
        material,
        activity,
        safety,
        structure,
        initiative,
        complexity: known.length ? Math.min(3, observation.moves.length / 18) * (1 - confidence) : 0,
        simplification: owns.has('exchange')
          ? (32 - observation.pieces.length) * 0.12 * (material > 0 ? 1.5 : 0.5)
          : 0,
        prevention,
        progress:
          owns.has('conversion') && totalAttackers <= 6
            ? activity * 0.3
            : owns.has('soldier-advance')
              ? own.filter(p => p.role === 'soldier').reduce((s, p) => s + progress(p) * 0.15, 0)
              : 0,
        roles: roleActivity,
      },
    };
  }
  replyClass(observation: Observation, move: Move): string {
    return `${move.actor}/${observation.checked.includes(move.actor) ? 'evade' : move.capture ? `capture-${move.captureRole}` : ['general', 'advisor', 'elephant'].includes(move.role!) ? 'shelter' : forward(move, move.actor) ? 'advance' : 'reposition'}/${move.role}`;
  }
  trapCue(
    _observation: Observation,
    temptation: Move,
    refutation: Move,
    after: Observation,
    known: readonly string[],
  ): number {
    if (!known.includes('counterplay') || !temptation.capture || temptation.actor === refutation.actor)
      return 0;
    if ((after.terminal?.[refutation.actor] ?? 0) > 0) return 1;
    if (!known.includes('recapture') || refutation.capture !== temptation.piece) return 0;
    // A cheap apparent gain followed by an examined winning recapture. Ordinary equal
    // exchanges and unrelated simultaneous attacks do not establish a practical trap.
    const gain = values[temptation.role!] - values[temptation.captureRole!];
    return Math.max(0, Math.min(1, gain / 5));
  }
  goalValid(goal: Plan, observation: Observation, player: Player): boolean {
    return (
      !observation.terminal &&
      (!goal.role || observation.pieces.some(p => p.owner === player && p.role === goal.role)) &&
      observation.ply - goal.createdPly < 36
    );
  }
  slipAlternatives(move: Move, observation: Observation): readonly string[] {
    const [x, y] = coordinates(move.to!);
    return observation.moves
      .filter(
        m =>
          m.from === move.from &&
          m.action !== move.action &&
          Math.abs(coordinates(m.to!)[0] - x) + Math.abs(coordinates(m.to!)[1] - y) === 1,
      )
      .map(m => m.action);
  }
}
