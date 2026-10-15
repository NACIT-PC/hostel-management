#!/usr/bin/env node
/**
 * Command-line entry point for the Hostel Bed Allocation System.
 *
 *   node bin/hostel.js                 -> interactive menu (default command)
 *   node bin/hostel.js --help          -> full command reference
 *   node bin/hostel.js init            -> create the database + schema
 *   node bin/hostel.js seed            -> load demo data
 *   node bin/hostel.js availability    -> and so on
 *
 * The database connection is always closed before the process exits so WAL
 * files are checkpointed cleanly.
 */
import { buildProgram, closeDatabase } from '../src/cli/commands.js';
import { printError } from '../src/cli/ui.js';

async function main() {
  const program = buildProgram();
  // Throw CommanderError instead of calling process.exit() directly, so we can
  // close the database and print our own (friendlier) error messages.
  program.exitOverride();

  try {
    await program.parseAsync(process.argv);
    return 0;
  } catch (error) {
    // Help / version / usage errors already printed their own message.
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
