/** Keyed draws: adding logs, another identity or an unused candidate consumes no shared stream. */
export function hash(value: string): string {
  let a = 2166136261,
    b = 2246822507;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 3266489909);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
export function uniform(seed: string, key: string): number {
  let value = parseInt(hash(`${seed}\u001f${key}`).slice(0, 8), 16);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return ((value >>> 0) + 0.5) / 4294967296;
}
export function normal(seed: string, key: string): number {
  return (
    Math.sqrt(-2 * Math.log(uniform(seed, `${key}/radius`))) *
    Math.cos(2 * Math.PI * uniform(seed, `${key}/angle`))
  );
}
export function clamp(value: number, low = 0, high = 1): number {
  return Math.max(low, Math.min(high, value));
}
export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter(k => record[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonical(record[k])}`)
    .join(',')}}`;
}
export function fingerprint(value: unknown): string {
  return hash(canonical(value));
}
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
