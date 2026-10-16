#!/usr/bin/env node
import { buildProgram, closeDatabase } from '../src/cli/commands.js';
import { printError } from '../src/cli/ui.js';

async function main() {
  const program = buildProgram();
  program.exitOverride();

  try {
    await program.parseAsync(process.argv);
    return 0;
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('commander.')) {
      return typeof error.exitCode === 'number' ? error.exitCode : 1;
    }
    printError(error);
    return 1;
  } finally {
    closeDatabase();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    printError(error);
    process.exitCode = 1;
  });
