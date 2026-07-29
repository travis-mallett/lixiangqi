import { Result } from '@badrap/result';
import { type Position, parseUci, makeSquare } from 'chessops';
import { chessgroundDests, lichessRules, scalachessCharPair } from 'chessops/compat';
import { parseFen } from 'chessops/fen';
import { setupPosition } from 'chessops/variant';

import { memoize } from '@/common';
import { xiangqiLegalMoveDests } from '@/game';

import type { PositionResult, TreeNode, TreeNodeBase } from './types';

// mutates and returns the node
export const completeNode =
  (variant: VariantKey) =>
  (from: TreeNodeBase): TreeNode => {
    const node = from as TreeNode;
    if (variant === 'xiangqi') {
      node.id ||= node.uci ?? '';
      node.children ||= [];
      node.pos ||= memoize(() =>
        Result.err(new Error('Xiangqi positions come from the native rules boundary')),
      );
      node.dests ||= memoize(() => xiangqiLegalMoveDests(node.xiangqiLegalMoves ?? []) as Dests);
      node.drops ||= memoize(() => []);
      node.check ||= memoize(() => node.xiangqiCheck ?? false);
      node.outcome ||= memoize(() => undefined);
      node.children.forEach(completeNode(variant));
      return node;
    }
    node.id ||= node.uci ? scalachessCharPair(parseUci(node.uci)!) : '';
    node.children ||= [];
    node.pos ||= memoize(() =>
      parseFen(node.fen).chain(setup => setupPosition(lichessRules(variant), setup)),
    );
    node.dests = memoize(() => computeDests(node.pos(), variant === 'chess960'));
    node.drops = memoize(() => computeDrops(variant, node.pos()));
    node.check = memoize(() => computeCheck(node.pos()));
    node.outcome ||= memoize(() => computeOutcome(node.pos()));
    node.children.forEach(completeNode(variant));
    return node;
  };

const computeDests = (position: PositionResult, chess960: boolean) =>
  withPosition<Dests>(position, new Map(), p => chessgroundDests(p, { chess960 }));

const computeDrops = (variant: VariantKey, position: PositionResult): Key[] | undefined =>
  variant === 'crazyhouse'
    ? withPosition(position, undefined, p => Array.from(p.dropDests(), makeSquare))
    : [];

const computeCheck = (position: PositionResult) => withPosition(position, false, p => p.isCheck());

const computeOutcome = (position: PositionResult) => withPosition(position, undefined, p => p.outcome());

const withPosition = <A>(position: PositionResult, defaultValue: A, f: (p: Position) => A): A =>
  position.unwrap(f, err => {
    console.error(err);
    return defaultValue;
  });
