import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
execFileSync(
  process.env.CXX || 'clang++',
  [
    '--target=wasm32',
    '-std=c++17',
    '-O3',
    '-flto',
    '-ffreestanding',
    '-fno-exceptions',
    '-fno-rtti',
    '-mbulk-memory',
    '-nostdlib',
    '-fconstexpr-steps=10000000',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-Wl,--no-entry,--strip-all,--export-memory,-z,stack-size=65536,--initial-memory=196608,--max-memory=196608',
    ...['input', 'analyse', 'lines', 'nodes'].map(name => '-Wl,--export=' + name),
    'external/banqifish/search.cpp',
    '-o',
    process.argv[2] || 'public/banqi-engine/banqifish-v1.wasm',
  ],
  { cwd: root, stdio: 'inherit' },
);
