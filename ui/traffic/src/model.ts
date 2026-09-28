export interface Row {
  key?: string;
  at?: string;
  visitors: number;
  visitorsLower: number;
  visitorsUpper: number;
  sessions: number;
  participants: number;
  counts: Record<string, number>;
  waitP50?: number;
  waitP90?: number;
  waitP95?: number;
}
export interface Report {
  from: string;
  until: string;
  grain: string;
  dimension: string;
  summary: Row;
  series: Row[];
  groups: Row[];
  quality: { processedAt?: string; oldestPendingAt?: string; retention: string };
  registrationBaseline?: number;
  smallCellsSuppressed?: boolean;
  catalog: { appearance: Record<string, Record<string, string>> };
}
export interface Snapshot {
  day?: string;
  rows: { dimension: string; key: string; count: number }[];
}
export function metric(row: Row, key: string): number {
  if (['visitors', 'sessions', 'participants', 'waitP50', 'waitP90', 'waitP95'].includes(key))
    return (row[key as keyof Row] as number | undefined) || 0;
  const c = row.counts;
  if (key === 'beforeSwitch') return c.selectionEpisodes ? (c.selectedUseMs || 0) / c.selectionEpisodes : 0;
  if (['lcpMs', 'inpMs', 'clsMilli'].includes(key))
    return c[key + 'Count'] ? (c[key] || 0) / c[key + 'Count'] : 0;
  if (key === 'engagement') return c.visibleMs ? (100 * (c.engagedMs || 0)) / c.visibleMs : 0;
  if (key === 'meanVisit') return c.visit_closed ? (c.visit_closed_durationMs || 0) / c.visit_closed : 0;
  if (key === 'quickExit') return c.visit_closed ? (100 * (c.quickExit || 0)) / c.visit_closed : 0;
  if (key === 'musicShare') return c.engagedMs ? (100 * (c.musicEnabledMs || 0)) / c.engagedMs : 0;
  if (key === 'effectsShare') return c.engagedMs ? (100 * (c.effectsEnabledMs || 0)) / c.engagedMs : 0;
  if (key === 'playingShare') return c.engagedMs ? (100 * (c.musicPlayingMs || 0)) / c.engagedMs : 0;
  return c[key] || 0;
}

/** Missing denominators/percentiles are unavailable, never a measured zero. */
export function observed(row: Row, key: string): boolean {
  if (['waitP50', 'waitP90', 'waitP95'].includes(key)) return row[key as keyof Row] != null;
  const denominator: Record<string, string> = {
    lcpMs: 'lcpMsCount',
    inpMs: 'inpMsCount',
    clsMilli: 'clsMilliCount',
    engagement: 'visibleMs',
    meanVisit: 'visit_closed',
    quickExit: 'visit_closed',
    musicShare: 'engagedMs',
    effectsShare: 'engagedMs',
    playingShare: 'engagedMs',
    beforeSwitch: 'selectionEpisodes',
  };
  return !denominator[key] || (row.counts[denominator[key]] || 0) > 0;
}
export const percentMetrics = new Set([
  'engagement',
  'quickExit',
  'musicShare',
  'effectsShare',
  'playingShare',
]);
export const timeMetrics = new Set([
  'visibleMs',
  'engagedMs',
  'boardMs',
  'solvingMs',
  'musicEnabledMs',
  'effectsEnabledMs',
  'musicPlayingMs',
  'waitP50',
  'waitP90',
  'waitP95',
  'meanVisit',
  'lcpMs',
  'inpMs',
  'beforeSwitch',
]);
/** Fill missing calendar buckets; never interpolate missing measurements. */
export function calendar(report: Report): Row[] {
  const rows = new Map(report.series.map(row => [row.at!, row]));
  const date = new Date(report.from);
  if (report.grain === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (report.grain === 'month' || report.grain === 'year') date.setUTCDate(1);
  if (report.grain === 'year') date.setUTCMonth(0);
  const result: Row[] = [];
  while (date < new Date(report.until) && result.length <= 500) {
    const at = date.toISOString().replace('.000Z', 'Z');
    result.push(
      rows.get(at) || {
        at,
        visitors: 0,
        visitorsLower: 0,
        visitorsUpper: 0,
        sessions: 0,
        participants: 0,
        counts: {},
      },
    );
    if (report.grain === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
    else if (report.grain === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
    else if (report.grain === 'hour') date.setUTCHours(date.getUTCHours() + 1);
    else date.setUTCDate(date.getUTCDate() + (report.grain === 'week' ? 7 : 1));
  }
  return result;
}
