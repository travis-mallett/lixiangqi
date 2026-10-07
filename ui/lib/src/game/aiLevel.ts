/** Public computer difficulty range. */
export const aiLevels: readonly number[] = Array.from({ length: 720 }, (_, i) => i + 1);

/** Engine levels exposed as the ten choices in the Custom Bot setup. */
export const aiCustomLevels: readonly number[] = [1, 9, 98, 187, 276, 364, 453, 542, 631, 720];

export const aiCustomLevel = (index: number): number => {
  if (!Number.isInteger(index) || index < 0 || index >= aiCustomLevels.length)
    throw new RangeError('Custom bot level must be an integer from 0 through 9');
  return aiCustomLevels[index];
};

/** Map any stored engine level to the nearest Custom Bot choice. */
export const aiCustomLevelIndex = (level: number): number =>
  aiCustomLevels.reduce(
    (nearest, candidate, index) =>
      Math.abs(candidate - level) < Math.abs(aiCustomLevels[nearest] - level) ? index : nearest,
    0,
  );

export const aiLevelName = (level: number): string => i18n.site.aiNameLevelAiLevel('Pikafish', level);
