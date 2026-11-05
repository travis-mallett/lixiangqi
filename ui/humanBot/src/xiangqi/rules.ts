import { fingerprint, freeze } from '../random';
import type { Move, Observation, Outcome, Question, Relation, RulesAdapter } from '../types';

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
export interface XiangqiSnapshot {
  initialFen: string;
  ruleset: 'tiantian-v1' | 'unrestricted-v1';
  moves: readonly string[];
}
interface NativeState {
  fen: string;
  ruleset: string;
  ply: number;
  turn: string;
  moves: string[];
  check: boolean;
  result: string;
  termination: string | null;
  naturalPlies: number;
  pieces: { square: string; player: string; role: string }[];
}
export interface NativeRules {
  initial(fen: string, ruleset: string): unknown;
  play(handle: unknown, action: string): unknown;
  inspect(handle: unknown): NativeState;
  targets(handle: unknown, square: string): string[];
}
export interface XiangqiPosition {
  readonly fen: string;
  readonly handle: unknown;
  readonly snapshot: XiangqiSnapshot;
  readonly identities: Readonly<Record<string, string>>;
  readonly key: string;
  readonly observation: Observation;
}
export function coordinates(location: string): readonly [number, number] {
  return [location.charCodeAt(0) - 97, Number(location.slice(1))];
}
export function splitMove(action: string): readonly [string, string] {
  const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(action);
  if (!match) throw new Error(`Invalid xiangqi action: ${action}`);
  return [match[1], match[2]];
}
/** The bridge is compiled from modules/xiangqi, including the full Tiantian history policy. */
export class XiangqiAdapter implements RulesAdapter<XiangqiPosition, XiangqiSnapshot> {
  readonly version = 'native-xiangqi-1';
  private restored?: XiangqiPosition;
  constructor(private readonly native: NativeRules) {}
  restore(snapshot: XiangqiSnapshot): XiangqiPosition {
    if (!['tiantian-v1', 'unrestricted-v1'].includes(snapshot.ruleset) || snapshot.moves.length > 2048)
      throw new Error('Unsupported rules or history length');
    const prior = this.restored;
    const extendsPrior =
      prior &&
      prior.snapshot.initialFen === snapshot.initialFen &&
      prior.snapshot.ruleset === snapshot.ruleset &&
      prior.snapshot.moves.length <= snapshot.moves.length &&
      prior.snapshot.moves.every((move, i) => move === snapshot.moves[i]);
    // Only the real restored history enters this one-position exact cache. Search
    // branches cannot replace it. Metadata/annotation fields are not position identity.
    let position = extendsPrior
      ? prior
      : this.wrap(this.native.initial(snapshot.initialFen, snapshot.ruleset), {
          initialFen: snapshot.initialFen,
          ruleset: snapshot.ruleset,
          moves: [],
        });
    for (const move of snapshot.moves.slice(position.snapshot.moves.length))
      position = this.play(position, move)[0].position;
    this.restored = position;
    return position;
  }
  snapshot(position: XiangqiPosition): XiangqiSnapshot {
    return structuredClone(position.snapshot);
  }
  observe(position: XiangqiPosition): Observation {
    return position.observation;
  }
  play(position: XiangqiPosition, action: string): readonly Outcome<XiangqiPosition>[] {
    if (!position.observation.moves.some(m => m.action === action))
      throw new Error('Illegal xiangqi transition');
    const [from, to] = splitMove(action);
    const identities = { ...position.identities, [to]: position.identities[from] };
    delete identities[from];
    const handle = this.native.play(position.handle, action);
    return [
      {
        probability: 1,
        position: this.wrap(
          handle,
          { ...position.snapshot, moves: [...position.snapshot.moves, action] },
          identities,
          position.observation.moves.find(m => m.action === action),
        ),
      },
    ];
  }
  inspect(position: XiangqiPosition, question: Question): Relation {
    if (question.kind !== 'attacks') throw new Error('Unknown xiangqi inspection');
    const piece = position.observation.pieces.find(p => p.id === question.subject);
    if (!piece)
      return {
        question: question.id,
        subject: question.subject,
        kind: question.kind,
        targets: [],
        confidence: 1,
      };
    return {
      question: question.id,
      subject: question.subject,
      kind: question.kind,
      targets: this.native.targets(position.handle, piece.location).sort(),
      confidence: 1,
    };
  }
  private wrap(
    handle: unknown,
    snapshot: XiangqiSnapshot,
    identities?: Readonly<Record<string, string>>,
    lastMove?: Move,
  ): XiangqiPosition {
    const state = this.native.inspect(handle);
    const ids =
      identities ?? Object.fromEntries(state.pieces.map(p => [p.square, `${p.player}/${p.square}`]));
    const pieces = state.pieces.map(p => ({
      id: ids[p.square],
      owner: p.player,
      role: p.role,
      location: p.square,
      x: coordinates(p.square)[0],
      y: coordinates(p.square)[1],
    }));
    const bySquare = new Map(pieces.map(p => [p.location, p]));
    const key = `${this.version}/${fingerprint(snapshot)}`;
    const terminal =
      state.result === '*'
        ? undefined
        : state.result === '1/2-1/2'
          ? { red: 0, black: 0 }
          : state.result === '1-0'
            ? { red: 1, black: -1 }
            : state.result === '0-1'
              ? { red: -1, black: 1 }
              : undefined;
    if (state.result !== '*' && !terminal) throw new Error(`Unrecognized native result: ${state.result}`);
    const moves: Move[] = state.moves.map(action => {
      const [from, to] = splitMove(action),
        piece = bySquare.get(from)!,
        captured = bySquare.get(to);
      return {
        action,
        actor: state.turn,
        piece: piece.id,
        role: piece.role,
        from,
        to,
        capture: captured?.id,
        captureRole: captured?.role,
      };
    });
    return Object.freeze({
      fen: state.fen,
      handle,
      snapshot: freeze(snapshot),
      identities: freeze(ids),
      key,
      observation: freeze({
        key,
        rulesVersion: this.version,
        variant: 'xiangqi',
        turn: state.turn,
        players: ['red', 'black'],
        ply: state.ply,
        history: snapshot.moves,
        pieces,
        moves,
        lastMove,
        checked: state.check ? [state.turn] : [],
        terminal,
        rulePressure: Math.min(1, state.naturalPlies / 100),
      }),
    });
  }
}
