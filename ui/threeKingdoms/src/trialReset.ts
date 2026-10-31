/** Retire trial records once, preserving the exact originals for recovery. No legacy rules runtime. */
export function resetTrialStorage(storage: Storage = localStorage): void {
  const containsTrialPosition = (value: unknown): boolean =>
    typeof value === 'string'
      ? value.startsWith('TK1;') && value.split(';').length === 12
      : !!value && typeof value === 'object' && Object.values(value).some(containsTrialPosition);
  for (const key of [
    'threeKingdoms.localGame',
    'threeKingdoms.localHistory',
    'threeKingdoms.analysis.tabs.v1',
    'threeKingdoms.analysis.v1',
  ]) {
    const original = storage.getItem(key);
    if (!original || !containsTrialPosition(JSON.parse(original))) continue;
    const backup = `threeKingdoms.trialBackup.20261030.${key}`;
    const saved = storage.getItem(backup);
    if (saved !== null && saved !== original) throw new Error('Three Kingdoms trial backup differs');
    storage.setItem(backup, original);
    if (storage.getItem(backup) !== original) throw new Error('Three Kingdoms trial backup failed');
    storage.removeItem(key);
  }
}
