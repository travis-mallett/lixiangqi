import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadEngine(id) {
  const legacy = id === 'baseline';
  if (legacy && !process.env.BANQI_BASELINE)
    throw Error('Set BANQI_BASELINE to the archived public engine directory');
  if (!legacy && id !== 'fish') throw Error('Unknown engine ' + id);
  const dir = legacy
    ? pathToFileURL(resolve(process.env.BANQI_BASELINE) + '/')
    : new URL('../../../public/banqi-engine/', import.meta.url);
  const { search } = await import(new URL(legacy ? 'worker-v1.js' : 'banqifish-worker-v1.js', dir));
  const bytes = await readFile(new URL(legacy ? 'misty-banqi-v1.wasm' : 'banqifish-v1.wasm', dir));
  const instance = (await WebAssembly.instantiate(bytes)).instance.exports;
  return { search: (...args) => search(instance, ...args), bytes: bytes.length, memory: instance.memory };
}

// SplitMix32, with a separate stream for engine choices and the private deal.
export function random(seed) {
  return () => {
    seed = (seed + 0x9e3779b9) >>> 0;
    let n = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
    return (n ^ (n >>> 15)) >>> 0;
  };
}
