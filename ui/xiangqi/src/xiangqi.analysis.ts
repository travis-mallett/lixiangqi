import type { AnalysisVariant } from './analysisVariant';
import type { AnalysisBootstrap } from './analysisXiangqi';

export default async function init(
  bootstrap: Omit<AnalysisBootstrap, 'variant'> & { variant?: AnalysisVariant } = {},
): Promise<void> {
  if (bootstrap.variant === 'threeKingdoms') {
    const { initThreeKingdomsAnalysis } = await import('./analysisThreeKingdoms');
    await initThreeKingdomsAnalysis(bootstrap);
  } else {
    const { default: initXiangqi } = await import('./analysisXiangqi');
    initXiangqi({ ...bootstrap, variant: bootstrap.variant });
  }
}
