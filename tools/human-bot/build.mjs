import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, 'ui/humanBot/dist');
const require = createRequire(join(root, 'ui/.build/package.json'));
const { build } = require('esbuild');
const digest = data => createHash('sha256').update(data).digest('hex');
export function sourceManifest() {
  return Object.fromEntries(
    [
      'modules/xiangqi/src/main',
      'modules/threeKingdomsCore/src/main',
      'tools/human-bot/rules/src',
      'tools/human-bot/rules/project',
    ]
      .flatMap(base =>
        readdirSync(join(root, base), { recursive: true })
          .filter(path => /\.(scala|sbt|properties)$/.test(path) && !path.includes('target'))
          .map(path => `${base}/${path.replaceAll('\\', '/')}`),
      )
      .concat(['tools/human-bot/rules/build.sbt'])
      .sort()
      .map(path => [path, digest(readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n'))]),
  );
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}
// Use the workspace dependency graph to generate declarations before checking
// the standalone package, including transitive dependencies such as the board.
run(process.execPath, ['--no-warnings', 'ui/.build/src/main.ts', '--no-install', '--tsc', 'humanBot']);
if (!process.argv.includes('--skip-rules')) {
  const windowsJava = join(root, '.tools/jdk-21');
  const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : existsSync(windowsJava)
      ? join(
          windowsJava,
          readdirSync(windowsJava).find(name => name.startsWith('jdk-21')),
          'bin/java.exe',
        )
      : 'java';
  const launcher = process.env.SBT_LAUNCHER ?? join(root, '.tools/sbt/sbt-launch-2.0.3.jar');
  if (existsSync(launcher))
    run(
      java,
      [
        '-Dsbt.server.autostart=false',
        `-Dsbt.boot.directory=${join(root, '.tools/sbt-boot')}`,
        `-Dsbt.global.base=${join(root, '.tools/sbt-global')}`,
        `-Dsbt.ivy.home=${join(root, '.tools/sbt-ivy')}`,
        '-jar',
        launcher,
        'scalafmtCheckAll',
        'scalafmtSbtCheck',
        'fullLinkJS',
      ],
      join(root, 'tools/human-bot/rules'),
    );
  else
    run('sbt', ['scalafmtCheckAll', 'scalafmtSbtCheck', 'fullLinkJS'], join(root, 'tools/human-bot/rules'));
  writeFileSync(
    join(output, 'rules-manifest.json'),
    JSON.stringify(
      { sources: sourceManifest(), javascript: digest(readFileSync(join(output, 'rules/main.js'))) },
      null,
      2,
    ),
  );
} else if (existsSync(join(output, 'rules-manifest.json'))) {
  const manifest = JSON.parse(readFileSync(join(output, 'rules-manifest.json')));
  if (
    JSON.stringify(manifest.sources) !== JSON.stringify(sourceManifest()) ||
    manifest.javascript !== digest(readFileSync(join(output, 'rules/main.js')))
  )
    throw new Error('Stale browser rules; rebuild without --skip-rules');
} else throw new Error('Rules manifest missing; run a complete build first');
mkdirSync(output, { recursive: true });
const release = JSON.parse(readFileSync(join(root, 'scripts/pikafish/release.json'), 'utf8'));
const network = readFileSync(join(root, 'public/pikafish-web/pikafish.nnue'));
if (digest(network) !== release.files['pikafish.nnue'].sha256)
  throw new Error('Run scripts/pikafish/install.py --browser-dir public/pikafish-web');
writeFileSync(
  join(output, 'engine-manifest.json'),
  JSON.stringify(
    {
      version: `${release.tag}/web-${digest(readFileSync(join(root, 'public/pikafish-web/pikafish.wasm'))).slice(0, 12)}`,
      networkSha256: release.files['pikafish.nnue'].sha256,
      files: Object.fromEntries(
        ['pikafish.js', 'pikafish.wasm', 'pikafish.nnue'].map(file => [
          file,
          digest(readFileSync(join(root, 'public/pikafish-web', file))),
        ]),
      ),
    },
    null,
    2,
  ),
);
await build({
  absWorkingDir: root,
  entryPoints: {
    index: 'ui/humanBot/src/index.ts',
    xiangqi: 'ui/humanBot/src/xiangqi/index.ts',
    worker: 'ui/humanBot/src/worker.ts',
  },
  outdir: output,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2021',
  minify: true,
  sourcemap: true,
});
console.log(`Standalone browser package: ${output}`);
