export const puzzleVariants = ['xiangqi'] as const;

export type PuzzleVariant = (typeof puzzleVariants)[number];

/**
 * Puzzle data is a variant-tagged contract. Unsupported variants must fail at
 * the boundary instead of falling through to an unrelated ruleset.
 */
export function parsePuzzleVariant(value: unknown): PuzzleVariant {
  if (puzzleVariants.includes(value as PuzzleVariant)) return value as PuzzleVariant;
  throw new Error(`Unsupported puzzle variant: ${String(value)}`);
}
