import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// Use the identical audited engine in the server worker and browser analysis.
const selected = process.argv[2] ?? 'jqe';
if (!['jqe', 'pikajieqi'].includes(selected)) throw new Error(`Unknown Jieqi engine: ${selected}`);
const file = selected === 'jqe' ? 'jqe/jqe' : 'pikajieqi';
const { default: createEngine } = await import(`../../public/jieqi-engine/${file}.js`);

const module = await createEngine({
  print: line => process.stdout.write(line + '\n'),
  printErr: console.error,
});
if (selected === 'jqe') {
  module.FS.writeFile(
    '/it014.jqn',
    await readFile(new URL('../../public/jieqi-engine/jqe/it014.jqn', import.meta.url)),
  );
  if (!module.cwrap('jqe_initialize', 'number', [])()) throw new Error('jqe network initialization failed');
} else module.cwrap('pikajieqi_initialize', null, [])();
const command = module.cwrap(`${selected}_command`, null, ['string']);
createInterface({ input: process.stdin })
  .on('line', line => {
    if (line === 'quit') process.exit(0);
    command(line);
  })
  .on('close', () => process.exit(0));
