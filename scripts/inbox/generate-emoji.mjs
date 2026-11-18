import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Download the pinned input from emoji-source.json, then supply its local path.
// No remote fetching or arbitrary asset dependencies are hidden in app builds.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = JSON.parse(fs.readFileSync(new URL('./emoji-source.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const input = args.shift();
if (!input || args.some(a => a !== '--check'))
  throw new Error('Usage: node scripts/inbox/generate-emoji.mjs EMOJI-TEST.TXT [--check]');
const raw = fs.readFileSync(input);
if (createHash('sha256').update(raw).digest('hex') !== source.sha256)
  throw new Error(`Expected Unicode ${source.version} input with SHA-256 ${source.sha256}`);
const rows = raw
  .toString('utf8')
  .split('\n')
  .flatMap(line => {
    const match = line.match(/^([0-9A-F ]+)\s*; fully-qualified\s*# \S+ E[\d.]+ (.+)$/);
    return match
      ? [
          [
            String.fromCodePoint(
              ...match[1]
                .trim()
                .split(/\s+/)
                .map(cp => parseInt(cp, 16)),
            ),
            match[2],
          ],
        ]
      : [];
  });
if (rows.length !== source.count) throw new Error(`Unexpected emoji count: ${rows.length}`);
const web = path.join(root, 'public/javascripts/inbox');
const license = fs.readFileSync(path.join(web, 'UNICODE-LICENSE.txt'), 'utf8');
for (const directory of [web, path.resolve(root, '../lixiangqi-mobile/assets/inbox')]) {
  for (const [name, contents] of [
    ['emoji.json', JSON.stringify(rows) + '\n'],
    ['UNICODE-LICENSE.txt', license],
  ]) {
    const target = path.join(directory, name);
    if (args.includes('--check')) {
      if (fs.readFileSync(target, 'utf8') !== contents) throw new Error(`Out of date: ${target}`);
    } else {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(target, contents);
    }
  }
}
console.log(
  `${args.includes('--check') ? 'Verified' : 'Generated'} ${rows.length} Unicode ${source.version} emoji in both apps.`,
);
