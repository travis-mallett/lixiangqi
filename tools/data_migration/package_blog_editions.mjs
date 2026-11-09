import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contentRoot = path.join(root, 'blog/translations');
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const destinations = text => [...text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1]).sort();
const codeBlocks = text => [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m => m[1].trim());
const boardEmbeds = text =>
  [...text.matchAll(/<iframe\b[^>]*>[\s\S]*?<\/iframe>|<[^>]*data-(?:fen|pgn)=[^>]*>/g)].map(m => m[0]);

export function collect({ requireReview = true, directory = contentRoot } = {}) {
  const readJson = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
  const markdown = file => fs.readFileSync(path.join(directory, file), 'utf8').replaceAll('\r\n', '\n');
  const manifest = readJson('manifest.json');
  const metadata = readJson('editions.json');
  const reviews = fs.existsSync(path.join(directory, 'reviews.json')) ? readJson('reviews.json') : {};
  const expected = new Set(manifest.posts.flatMap(p => p.languages.map(language => `${p.id}/${language}`)));
  const seen = new Set();
  const release = metadata.map(meta => {
    const key = `${meta.id}/${meta.language}`;
    if (!expected.has(key) || seen.has(key)) throw Error(`Unexpected or duplicate edition: ${key}`);
    seen.add(key);
    const source = readJson(`${meta.id}/source.json`);
    const sourceRevision = digest([
      source.sourceLanguage,
      source.title,
      source.intro,
      source.markdown,
      source.image?.id ?? null,
      source.image?.alt ?? null,
      source.image?.credit ?? null,
    ]);
    if (
      sourceRevision !== source.sourceRevision ||
      sourceRevision !== manifest.posts.find(p => p.id === meta.id).sourceRevision
    )
      throw Error(`Source snapshot changed: ${key}`);
    const body = markdown(`${key}.md`);
    for (const [name, extract] of [
      ['links', destinations],
      ['code blocks', codeBlocks],
      ['board embeds', boardEmbeds],
    ]) {
      if (JSON.stringify(extract(source.markdown.replaceAll('\r\n', '\n'))) !== JSON.stringify(extract(body)))
        throw Error(`Translated ${name} differ from source: ${key}`);
    }
    if (!meta.title || !meta.intro || !meta.imageAlt || !body.trim())
      throw Error(`Incomplete edition: ${key}`);
    const payload = { ...meta, markdown: body, sourceLanguage: source.sourceLanguage, sourceRevision };
    const fingerprint = digest(payload);
    const review = reviews[key];
    if (
      requireReview &&
      (!review || review.fingerprint !== fingerprint || !review.editorial || !review.rendered)
    )
      throw Error(`Editorial/render review missing or stale: ${key} (${fingerprint})`);
    return {
      ...payload,
      translator: 'Codex (AI translation)',
      reviewer: 'Codex (AI editorial review)',
      reviewed: !!review?.editorial && !!review?.rendered && review.fingerprint === fingerprint,
      fingerprint,
    };
  });
  if (seen.size !== expected.size) throw Error('Missing editions');
  return release;
}

export function packageRelease() {
  return (
    `globalThis.blogEditionRelease = ${JSON.stringify(collect())};\n` +
    fs.readFileSync(path.join(root, 'tools/data_migration/20261108_blog_editions_v1.js'), 'utf8')
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--audit') {
    for (const item of collect({ requireReview: false }))
      console.log(`${item.id}/${item.language} ${item.fingerprint}`);
  } else if (args.length === 1 && args[0] === '--validate') {
    console.log(`Validated ${collect().length} reviewed editions.`);
  } else if (args.length === 2 && args[0] === '--output') {
    fs.writeFileSync(args[1], packageRelease());
    console.log(`Packaged 14 reviewed blog editions: ${args[1]}`);
  } else if (args.length === 2 && args[0] === '--check') {
    if (fs.readFileSync(args[1], 'utf8') !== packageRelease())
      throw Error('Packaged blog editions are stale');
    console.log('Packaged blog editions match the reviewed source.');
  } else throw Error('Usage: package_blog_editions.mjs --audit | --output FILE | --check FILE');
}
