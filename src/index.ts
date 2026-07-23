import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createCli } from './cli.js';

export { createCli } from './cli.js';
export type { CliIo, CliRunner, CreateCliOptions } from './cli.js';

export function isMainEntrypoint(moduleUrl: string, argv: string[]): boolean {
  const scriptPath = argv[1];

  if (!scriptPath) {
    return false;
  }

  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(scriptPath);
}

/* v8 ignore start */
if (isMainEntrypoint(import.meta.url, process.argv)) {
  const cli = createCli();
  void cli.run(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
/* v8 ignore end */
