import type { ProgressBar } from '../view/progressBar';
import type { PikafishStatus } from './engines/pikafishBrowser';

export const enginePreparing = (status: PikafishStatus): boolean =>
  ['loading', 'downloading', 'initializing'].includes(status.state);

export function engineLoadingText(status: PikafishStatus): string {
  if (status.state === 'initializing') return i18n.site.startingEngine;
  if (status.state === 'error') return i18n.site.engineLoadingFailed;
  if (status.state !== 'downloading') return i18n.site.loadingEngine;
  const size = (bytes: number) => (bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return status.total
    ? i18n.site.engineDownloadProgress(
        `${Math.min(100, Math.round((status.bytes * 100) / status.total))}%`,
        size(status.bytes),
        size(status.total),
      )
    : i18n.site.engineDownloadSize(size(status.bytes));
}

export function engineProgress(
  enabled: boolean,
  status: PikafishStatus,
  depth = 0,
  targetDepth = 1,
): ProgressBar {
  const preparing = enginePreparing(status);
  const computing = status.state === 'computing';
  let percent = Math.min(100, (100 * depth) / targetDepth);
  if (percent > 0 && !computing) percent = 100;
  return {
    percent:
      status.state === 'downloading'
        ? status.total
          ? Math.min(100, (status.bytes * 100) / status.total)
          : undefined
        : preparing
          ? undefined
          : Number.isFinite(percent)
            ? percent
            : 0,
    active: preparing || computing,
    visible: enabled || preparing,
    label: preparing ? engineLoadingText(status) : i18n.site.depthX(depth),
  };
}
