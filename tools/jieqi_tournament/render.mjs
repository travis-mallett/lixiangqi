import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2]);
const svg = await readFile(resolve(directory, 'results.svg'), 'utf8');
const png = new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
await writeFile(resolve(directory, 'results.png'), png);
