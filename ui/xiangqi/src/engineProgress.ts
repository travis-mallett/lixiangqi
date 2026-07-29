import type { PikafishStatus } from 'lib/ceval';

export interface EngineProgress {
  computing: boolean;
  percent: number;
  visible: boolean;
}

/** Mirrors the progress calculation used by Lichess's ceval view. */
export function engineProgress(
  enabled: boolean,
  status: PikafishStatus,
  depth: number,
  targetDepth: number,
): EngineProgress {
  const computing = status.state === 'computing';
  let percent = Math.min(100, (100 * depth) / targetDepth);

  if (status.state === 'downloading')
    percent = status.total ? Math.min(100, Math.round((100 * status.bytes) / status.total)) : 0;
  else if (percent > 0 && !computing) percent = 100;

  return {
    computing,
    percent: Number.isFinite(percent) ? percent : 0,
    visible: enabled || status.state === 'downloading',
  };
}
