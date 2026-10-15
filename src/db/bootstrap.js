/**
 * Database bootstrap.
 *
 * `init` -> schema + default settings, and creates the administrator account
 *           the first time it runs. There is no demo/sample data: the database
 *           starts empty apart from that single account.
 */
import { initDatabase, transact } from './connection.js';
import { createUser, countUsers } from '../services/authService.js';
import { DEFAULT_ADMIN } from '../config.js';

export function initialise({ force = false } = {}) {
  const db = initDatabase({ force });
  return db;
}

/**
 * Create the administrator account when the database has no users at all.
 * Safe to call repeatedly: it is a no-op once any account exists.
 *
 * @param {{ username?: string, password?: string, fullName?: string }} [options]
 * @returns {{ created: boolean, user?: object }}
 */
export function ensureAdministrator({
  username = DEFAULT_ADMIN.username,
  password = DEFAULT_ADMIN.password,
  fullName = DEFAULT_ADMIN.fullName,
} = {}) {
  initDatabase();
  if (countUsers() > 0) return { created: false };

  const user = transact(() =>
    createUser({ username, password, fullName, role: 'admin' }, null),
  );
  return { created: true, user };
}
