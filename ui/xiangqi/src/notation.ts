import type { XiangqiMoveTree, XiangqiTreeNode } from './tree';

interface MoveContext {
  fullmove: number;
  turn: 'red' | 'black';
}

export function renderXiangqiMovetext(tree: XiangqiMoveTree): string {
  return renderSequence(
    tree.root.children,
    startContext(tree.root.state.fen, tree.root.state.turn),
    false,
    true,
  );
}

export function renderXiangqiNotation(tree: XiangqiMoveTree, initialFen: string): string {
  const tags = [
    '[Variant "Xiangqi"]',
    `[FEN "${initialFen.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`,
    '[SetUp "1"]',
  ];
  const movetext = renderXiangqiMovetext(tree);
  return `${tags.join('\n')}\n\n${movetext ? `${movetext} ` : ''}*`;
}

function renderSequence(
  children: XiangqiTreeNode[],
  context: MoveContext,
  firstInVariation: boolean,
  isMainline: boolean,
): string {
  const [main, ...variations] = children;
  if (!main) return '';

  if (main.forceVariation && isMainline)
    return children.map(child => `(${renderSequence([child], context, true, false)})`).join(' ');

  const tokens = [`${movePrefix(context, firstInVariation)}${main.notation}`];
  variations.forEach(variation => {
    tokens.push(`(${renderSequence([variation], context, true, false)})`);
  });

  const continuation = renderSequence(main.children, nextContext(context), false, isMainline);
  if (continuation) tokens.push(continuation);
  return tokens.join(' ');
}

function startContext(fen: string, fallbackTurn: 'red' | 'black'): MoveContext {
  const fields = fen.trim().split(/\s+/);
  const fullmove = Number.parseInt(fields[5] ?? '1', 10);
  return {
    fullmove: Number.isSafeInteger(fullmove) && fullmove > 0 ? fullmove : 1,
    turn: fields[1] === 'b' ? 'black' : fields[1] === 'w' ? 'red' : fallbackTurn,
  };
}

function movePrefix(context: MoveContext, firstInVariation: boolean): string {
  if (context.turn === 'red') return `${context.fullmove}. `;
  return firstInVariation ? `${context.fullmove}... ` : '';
}

function nextContext(context: MoveContext): MoveContext {
  return context.turn === 'red'
    ? { fullmove: context.fullmove, turn: 'black' }
    : { fullmove: context.fullmove + 1, turn: 'red' };
}
