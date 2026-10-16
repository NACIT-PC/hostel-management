import { getDb } from '../db/connection.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { assertPermission, PERMISSIONS, ROLE_NAMES } from '../security/permissions.js';
import { log as auditLog } from './auditService.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  PermissionError,
} from '../utils/errors.js';
import { asText, asCode, asPassword, asOneOf, asBoolean } from '../utils/validate.js';

const ROLES = Object.keys(ROLE_NAMES);

const PUBLIC_COLUMNS = 'id, username, full_name, role, active, last_login_at, created_at';

export function roleLabel(role) {
  return ROLE_NAMES[role] ?? role;
}

export function countUsers() {
  return Number(getDb().prepare('SELECT COUNT(*) AS count FROM users').get().count);
}

export function countActiveAdmins() {
  return Number(
    getDb()
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1")
      .get().count,
  );
}

export function createUser(
  { username, fullName, password, role },
  actor = null,
  { selfService = false } = {},
) {
  if (countUsers() > 0 && !selfService) assertPermission(actor, PERMISSIONS.USER_MANAGE);

  const cleanUsername = asCode(username, 'Username', { max: 40 }).toLowerCase();
  const cleanName = asText(fullName, 'Full name', { max: 120 });
  const cleanRole = asOneOf(role, ROLES, 'Role');
  const cleanPassword = asPassword(password, 'Password');

  try {
    const info = getDb()
      .prepare(
        'INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)',
      )
      .run(cleanUsername, cleanName, hashPassword(cleanPassword), cleanRole);

    const user = getUserById(info.lastInsertRowid);
    auditLog({
      actor,
      action: 'user.created',
      entity: 'users',
      entityId: user.id,
      detail: `${user.username} (${user.role})`,
    });
    return user;
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw new ConflictError(`Username "${cleanUsername}" is already taken.`);
    }
    throw error;
  }
}

export function getUserById(id) {
  return getDb().prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(Number(id));
}

export function getByUsername(username) {
  return getDb()
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE username = ? COLLATE NOCASE`)
    .get(String(username).trim());
}

export function listUsers() {
  return getDb()
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY role, username COLLATE NOCASE`)
    .all();
}

export function authenticate(username, password) {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(String(username ?? '').trim());

  const ok = row ? verifyPassword(String(password ?? ''), row.password_hash) : false;
  if (!ok) {
    auditLog({
      action: 'auth.failed',
      entity: 'users',
      detail: `username attempted: ${String(username ?? '').slice(0, 60)}`,
    });
    return null;
  }
  if (!row.active) {
    auditLog({ action: 'auth.blocked', entity: 'users', entityId: row.id, detail: 'inactive account' });
    throw new PermissionError('This account has been deactivated. Contact an administrator.');
  }

  getDb().prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
  auditLog({ actor: { id: row.id, username: row.username }, action: 'auth.login', entity: 'users', entityId: row.id });
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
  };
}

export function changeOwnPassword(actor, oldPassword, newPassword) {
  if (!actor) throw new PermissionError('You must be signed in.');
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(actor.id);
  if (!row) throw new NotFoundError('Account not found.');
  if (!verifyPassword(String(oldPassword ?? ''), row.password_hash)) {
    throw new ValidationError('Current password is incorrect.');
  }
  const clean = asPassword(newPassword, 'New password');
  getDb()
    .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(clean), actor.id);
  auditLog({ actor, action: 'user.password_changed', entity: 'users', entityId: actor.id });
  return true;
}

export function resetPassword(targetUserId, newPassword, actor) {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);
  const target = getUserById(targetUserId);
  if (!target) throw new NotFoundError('User not found.');
  const clean = asPassword(newPassword, 'New password');
  getDb()
    .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(clean), target.id);
  auditLog({
    actor,
    action: 'user.password_reset',
    entity: 'users',
    entityId: target.id,
    detail: target.username,
  });
  return target;
}

export function setActive(targetUserId, active, actor) {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);
  const target = getUserById(targetUserId);
  if (!target) throw new NotFoundError('User not found.');
  const flag = asBoolean(active, 'Active');

  if (!flag && actor && target.id === actor.id) {
    throw new ValidationError('You cannot deactivate your own account.');
  }
  if (!flag && target.role === 'admin' && countActiveAdmins() <= 1) {
    throw new ValidationError('At least one active administrator must remain.');
  }

  getDb()
    .prepare("UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(flag ? 1 : 0, target.id);
  auditLog({
    actor,
    action: flag ? 'user.activated' : 'user.deactivated',
    entity: 'users',
    entityId: target.id,
    detail: target.username,
  });
  return getUserById(target.id);
}

export function updateUserRole(targetUserId, role, actor) {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);
  const target = getUserById(targetUserId);
  if (!target) throw new NotFoundError('User not found.');
  const cleanRole = asOneOf(role, ROLES, 'Role');
  if (target.role === 'admin' && cleanRole !== 'admin' && countActiveAdmins() <= 1) {
    throw new ValidationError('At least one active administrator must remain.');
  }
  getDb()
    .prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?")
    .run(cleanRole, target.id);
  auditLog({
    actor,
    action: 'user.role_changed',
    entity: 'users',
    entityId: target.id,
    detail: `${target.username}: ${target.role} -> ${cleanRole}`,
  });
  return getUserById(target.id);
}
