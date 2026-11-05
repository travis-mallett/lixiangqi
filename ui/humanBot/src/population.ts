import { compileProfile, SCALAR_IDS } from './controls';
import { normal, uniform } from './random';
import type { CompiledProfile, Controls, KnowledgeManifest, ProfileSpec, ScalarId } from './types';

export interface PopulationAxis {
  control: ScalarId;
  mean: number;
  deviation: number;
}
export interface PopulationSpec {
  seed: string;
  count: number;
  base: ProfileSpec;
  axes: readonly PopulationAxis[];
  /** Correlation matrix in axes order; omitted means independent truncated normals. */
  correlations?: readonly (readonly number[])[];
  /** Logistic-normal perturbation of installed side-specific family weights (K01). */
  repertoireDeviation?: number;
  /** Truncated-normal perturbation of each role affinity (S07). */
  roleDeviation?: number;
  /** Complete authored, prerequisite-valid curricula (K03), sampled once per identity. */
  curricula?: readonly { weight: number; knowledge: Controls['K03'] }[];
}
/** Rejection sampling avoids artificial probability piles at 0 and 1. No human frequencies implied. */
export function generatePopulation(spec: PopulationSpec, manifest: KnowledgeManifest): CompiledProfile[] {
  if (!Number.isInteger(spec.count) || spec.count < 1 || spec.count > 100000)
    throw new Error('Invalid population count');
  if (new Set(spec.axes.map(a => a.control)).size !== spec.axes.length)
    throw new Error('Duplicate population axis');
  for (const a of spec.axes)
    if (
      !SCALAR_IDS.includes(a.control) ||
      !Number.isFinite(a.mean) ||
      !Number.isFinite(a.deviation) ||
      a.deviation < 0 ||
      a.mean < (a.control === 'E03' ? -1 : 0) ||
      a.mean > 1
    )
      throw new Error('Invalid population axis');
  const size = spec.axes.length;
  for (const spread of [spec.repertoireDeviation ?? 0, spec.roleDeviation ?? 0])
    if (!Number.isFinite(spread) || spread < 0 || spread > 1)
      throw new Error('Structured spread must be in [0, 1]');
  if (spec.curricula) {
    if (
      !spec.curricula.length ||
      spec.curricula.some(c => !Number.isFinite(c.weight) || c.weight <= 0) ||
      Math.abs(spec.curricula.reduce((s, c) => s + c.weight, 0) - 1) > 1e-9
    )
      throw new Error('Curriculum weights must be positive and sum to one');
    for (const curriculum of spec.curricula)
      compileProfile(
        { ...spec.base, controls: { ...spec.base.controls, K03: curriculum.knowledge } },
        manifest,
      );
  }
  const matrix =
    spec.correlations ??
    Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => Number(i === j)));
  if (matrix.length !== size || matrix.some(row => row.length !== size))
    throw new Error('Invalid correlation dimensions');
  const lower = Array.from({ length: size }, () => Array<number>(size).fill(0));
  for (let i = 0; i < size; i++)
    for (let j = 0; j <= i; j++) {
      if (
        !Number.isFinite(matrix[i][j]) ||
        Math.abs(matrix[i][j]) > 1 ||
        Math.abs(matrix[i][j] - matrix[j][i]) > 1e-9 ||
        (i === j && matrix[i][j] !== 1)
      )
        throw new Error('Invalid correlation matrix');
      let value = matrix[i][j];
      for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
      if (i === j && value <= 1e-10) throw new Error('Correlation matrix must be positive definite');
      lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j];
    }
  return Array.from({ length: spec.count }, (_, index) => {
    for (let attempt = 0; attempt < 10000; attempt++) {
      const independent = spec.axes.map((_, i) => normal(spec.seed, `population/${index}/${attempt}/${i}`));
      const draws = spec.axes.map(
        (axis, i) => axis.mean + axis.deviation * lower[i].reduce((sum, v, j) => sum + v * independent[j], 0),
      );
      if (draws.some((v, i) => v < (spec.axes[i].control === 'E03' ? -1 : 0) || v > 1)) continue;
      const candidate = structuredClone(spec.base);
      candidate.id = `${spec.base.id}-${index.toString().padStart(5, '0')}`;
      candidate.seed = `${spec.seed}/${index}`;
      spec.axes.forEach((axis, i) => {
        candidate.controls[axis.control] = draws[i];
      });
      if (spec.repertoireDeviation)
        for (const [player, families] of Object.entries(candidate.controls.K01)) {
          const weights = Object.entries(families)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
              ([family, weight]) =>
                [
                  family,
                  weight *
                    Math.exp(
                      normal(spec.seed, `repertoire/${index}/${player}/${family}`) *
                        spec.repertoireDeviation!,
                    ),
                ] as const,
            );
          const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
          candidate.controls.K01[player] = Object.fromEntries(
            weights.map(([family, weight]) => [family, weight / total]),
          );
        }
      if (spec.roleDeviation)
        for (const [role, mean] of Object.entries(candidate.controls.S07)) {
          let value = -1,
            attempt = 0;
          while (value < 0 || value > 1) {
            if (++attempt > 10000) throw new Error('Role prior has negligible mass inside supported ranges');
            value = mean + normal(spec.seed, `role/${index}/${role}/${attempt}`) * spec.roleDeviation;
          }
          candidate.controls.S07[role] = value;
        }
      if (spec.curricula) {
        let draw = uniform(spec.seed, `curriculum/${index}`);
        const selected =
          spec.curricula.find(c => {
            draw -= c.weight;
            return draw <= 0;
          }) ?? spec.curricula[spec.curricula.length - 1];
        candidate.controls.K03 = structuredClone(selected.knowledge);
      }
      return compileProfile(candidate, manifest);
    }
    throw new Error('Population prior has negligible mass inside supported ranges');
  });
}
