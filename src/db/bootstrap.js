import { initDatabase, transact } from './connection.js';
import { createUser, countUsers } from '../services/authService.js';
import { DEFAULT_ADMIN } from '../config.js';

export function initialise({ force = false } = {}) {
  const db = initDatabase({ force });
  return db;
}

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
