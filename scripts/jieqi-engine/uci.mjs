import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// Use the identical audited engine in the server worker and browser analysis.
const selected = process.argv[2] ?? 'abjchess';
if (!['abjchess', 'jqe', 'pikajieqi'].includes(selected))
  throw new Error(`Unknown Jieqi engine: ${selected}`);
const file = selected === 'pikajieqi' ? selected : `${selected}/${selected}`;
const network = selected === 'abjchess' ? 'abjchess-20261030.nnue' : 'it014.jqn';
const { default: createEngine } = await import(`../../public/jieqi-engine/${file}.js`);

const module = await createEngine({
  print: line => process.stdout.write(line + '\n'),
  printErr: console.error,
});
if (selected !== 'pikajieqi') {
  module.FS.writeFile(
    '/' + network,
    await readFile(new URL(`../../public/jieqi-engine/${selected}/${network}`, import.meta.url)),
  );
  if (!module.cwrap(`${selected}_initialize`, 'number', [])())
    throw new Error(`${selected} network initialization failed`);
} else module.cwrap('pikajieqi_initialize', null, [])();
const command = module.cwrap(`${selected}_command`, null, ['string']);
createInterface({ input: process.stdin })
  .on('line', line => {
    if (line === 'quit') process.exit(0);
    command(line);
  })
  .on('close', () => process.exit(0));
