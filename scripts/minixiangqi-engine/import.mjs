import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Unpack fairy-stockfish-nnue.wasm@1.1.12, and download its exact commit source:
// https://codeload.github.com/fairy-stockfish/fairy-stockfish.wasm/zip/b2e693ef1e111233ce3fb40685921708b3276ed6
// Usage: node scripts/minixiangqi-engine/import.mjs <unpacked-package-dir> <source.zip>
const [packageDirectory, sourceArchive] = process.argv.slice(2);
if (!packageDirectory || !sourceArchive)
  throw new Error('Provide the unpacked package directory and source archive');
const expected = {
  'stockfish.js': '9080a62e3133e50da0c47b88b186d9c29ed37cc5129401bdeed8bffb5b9a4ca9',
  'stockfish.wasm': '7cea742b8ca1a324fbc500f89112f168134cf68eb49475df23be6c42336255c6',
  'stockfish.worker.js': '067be484ac62f728b0dad28496997e5862f3c61f9091f59bb35d9d1b1ed14573',
  'Copying.txt': '0b383d5a63da644f628d99c33976ea6487ed89aaa59f0b3257992deac1171e6b',
  AUTHORS: '55a0a4599358308af8349344d79176469f04119558e85595efe0a39b583cdf00',
  'source.zip': 'ee44972af9a96eb130549acbe753731a0c671ceaeb051da924f7b23606444c4e',
};
const files = Object.keys(expected).map(name => [
  name,
  resolve(name === 'source.zip' ? sourceArchive : resolve(packageDirectory, name)),
]);
for (const [name, file] of files) {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (hash !== expected[name]) throw new Error('Unexpected Mini Xiangqi engine artifact: ' + name);
}
const destination = fileURLToPath(new URL('../../public/minixiangqi-engine/', import.meta.url));
mkdirSync(destination, { recursive: true });
for (const [name, file] of files) copyFileSync(file, resolve(destination, name));
console.log('Imported verified Fairy-Stockfish artifacts and corresponding source.');
