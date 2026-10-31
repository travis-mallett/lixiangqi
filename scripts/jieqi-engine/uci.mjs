import { createInterface } from 'node:readline';

// Use the identical audited engine in the server worker and browser analysis.
import createEngine from '../../public/jieqi-engine/pikajieqi.js';

const module = await createEngine({
  print: line => process.stdout.write(line + '\n'),
  printErr: console.error,
});
module.cwrap('pikajieqi_initialize', null, [])();
const command = module.cwrap('pikajieqi_command', null, ['string']);
createInterface({ input: process.stdin })
  .on('line', line => {
    if (line === 'quit') process.exit(0);
    command(line);
  })
  .on('close', () => process.exit(0));
