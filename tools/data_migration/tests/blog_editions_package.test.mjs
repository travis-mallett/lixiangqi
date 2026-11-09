import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { collect, digest } from '../package_blog_editions.mjs';

test('publication requires matching editorial and rendered reviews and intact source data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-editions-package-'));
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  try {
    fs.mkdirSync(path.join(directory, 'abcdefgh'));
    const source = {
      sourceLanguage: 'vi',
      title: 'Cờ tướng',
      intro: 'Giới thiệu',
      markdown: '[position](/analysis/xiangqi)\n```\n1. H2+3\n```\n',
    };
    source.sourceRevision = digest(['vi', source.title, source.intro, source.markdown, null, null, null]);
    write('abcdefgh/source.json', source);
    write('manifest.json', {
      posts: [{ id: 'abcdefgh', sourceRevision: source.sourceRevision, languages: ['en'] }],
    });
    const meta = {
      id: 'abcdefgh',
      language: 'en',
      title: 'Xiangqi',
      intro: 'Introduction',
      imageAlt: 'Board',
    };
    write('editions.json', [meta]);
    fs.writeFileSync(path.join(directory, 'abcdefgh/en.md'), source.markdown);
    assert.throws(() => collect({ directory }), /review missing/);
    const [edition] = collect({ directory, requireReview: false });
    write('reviews.json', {
      'abcdefgh/en': {
        fingerprint: edition.fingerprint,
        editorial: 'Compared source and read independently',
        rendered: 'Inspected saved HTML',
      },
    });
    assert.equal(collect({ directory })[0].reviewed, true);
    write('editions.json', [{ ...meta, intro: 'Changed introduction' }]);
    assert.throws(() => collect({ directory }), /review missing or stale/);
    write('editions.json', [meta, meta]);
    assert.throws(() => collect({ directory }), /duplicate edition/);
    write('editions.json', [meta]);
    fs.appendFileSync(path.join(directory, 'abcdefgh/en.md'), '[unexpected](/wrong)');
    assert.throws(() => collect({ directory }), /links differ/);
    write('abcdefgh/source.json', { ...source, title: 'Changed source' });
    assert.throws(() => collect({ directory }), /Source snapshot changed/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
