/**
 * Administration menu: users, policy settings and database information.
 */
import { DB_PATH, SETTING_KEYS } from '../../config.js';
import { PERMISSIONS, ROLE_NAMES, describePermissions } from '../../security/permissions.js';
import * as authService from '../../services/authService.js';
import * as settingsService from '../../services/settingsService.js';
import * as auditService from '../../services/auditService.js';
import { databaseExists } from '../../db/connection.js';
import { color, dateTime, keyValue, money, print, success, table, warn } from '../ui.js';
import { amount, password, select, text, yesNo } from '../prompts.js';
import { runMenu } from './common.js';
import { changeOwnPassword, roleLabel } from '../../services/authService.js';

export async function adminMenu(actor) {
  await runMenu({
    title: 'Administration',
    actor,
    options: [
      {
        label: 'User accounts',
        value: 'users',
        permission: PERMISSIONS.USER_MANAGE,
        run: async () => {
          await usersMenu(actor);
          return false;
        },
      },
      {
        label: 'Change my password',
        value: 'mypassword',
        run: () => changeOwnPasswordFlow(actor),
      },
      {
        label: 'Policy settings (first deposit, currency, institution)',
        value: 'settings',
        permission: PERMISSIONS.SETTINGS_MANAGE,
        run: async () => {
          await settingsMenu(actor);
          return false;
        },
      },
      {
        label: 'Role & permission reference',
        value: 'roles',
        run: () => {
          print(
            table(
              Object.entries(ROLE_NAMES).map(([role, label]) => ({
                role: label,
                permissions: describePermissions(role).join('; '),
              })),
              [
                { key: 'role', header: 'Role' },
                { key: 'permissions', header: 'Can do' },
              ],
            ),
          );
        },
      },
      {
        label: 'Database & system information',
        value: 'system',
        run: () => {
          print(
            keyValue([
              ['Database file', DB_PATH],
              ['Database present', databaseExists() ? color.green('yes') : color.red('no')],
              ['Users', String(authService.countUsers())],
              ['Active administrators', String(authService.countActiveAdmins())],
              ['First deposit policy', money(settingsService.getFirstDepositRequirement(), settingsService.getCurrency())],
              ['Institution', settingsService.getInstitutionName()],
            ]),
          );
        },
      },
      {
        label: 'Audit trail',
        value: 'audit',
        permission: PERMISSIONS.AUDIT_VIEW,
        run: () => {
          const rows = auditService.listAuditLog({ limit: 40 });
          print(
            table(
              rows.map((row) => ({ ...row, username: row.username ?? color.dim('system') })),
              [
                { key: 'id', header: 'ID', align: 'right' },
                { key: 'at', header: 'When', format: (row) => dateTime(row.at) },
                { key: 'username', header: 'User', format: (row) => row.username },
                { key: 'action', header: 'Action' },
                { key: 'detail', header: 'Detail', format: (row) => row.detail ?? color.dim('-') },
              ],
              { empty: 'No audit entries yet.' }),
          );
        },
      },
    ],
  });
}

async function usersMenu(actor) {
  await runMenu({
    title: 'User accounts',
    actor,
    options: [
      {
        label: 'List users',
        value: 'list',
        permission: PERMISSIONS.USER_MANAGE,
        run: () => {
          print(
            table(
              authService.listUsers().map((row) => ({
                ...row,
                role: roleLabel(row.role),
                state: row.active === 1 ? color.green('active') : color.yellow('disabled'),
              })),
              [
                { key: 'id', header: 'ID', align: 'right' },
                { key: 'username', header: 'Username' },
                { key: 'full_name', header: 'Full name' },
                { key: 'role', header: 'Role', format: (row) => row.role },
                { key: 'state', header: 'State', format: (row) => row.state },
                { key: 'last_login_at', header: 'Last login', format: (row) => dateTime(row.last_login_at) },
              ],
            ),
          );
        },
      },
      {
        label: 'Create a user',
        value: 'create',
        permission: PERMISSIONS.USER_MANAGE,
        run: () => createUserFlow(actor),
      },
      {
        label: 'Reset a user\'s password',
        value: 'reset',
        permission: PERMISSIONS.USER_MANAGE,
        run: () => resetPasswordFlow(actor),
      },
      {
        label: 'Change a user\'s role',
        value: 'role',
        permission: PERMISSIONS.USER_MANAGE,
        run: () => changeRoleFlow(actor),
      },
      {
        label: 'Enable / disable a user',
        value: 'active',
        permission: PERMISSIONS.USER_MANAGE,
        run: () => toggleActiveFlow(actor),
      },
    ],
  });
}

async function pickUser(message = 'Select user') {
  const users = authService.listUsers();
  if (!users.length) {
    print(warn('No users found.'));
    return null;
  }
  const id = await select(
    message,
    users.map((user) => ({
      name: `${user.username} - ${user.full_name} (${roleLabel(user.role)}${user.active === 1 ? '' : ', disabled'})`,
      value: user.id,
    })),
  );
  return authService.getUserById(id);
}

async function createUserFlow(actor) {
  const username = await text('Username', { field: 'Username', max: 40 });
  const fullName = await text('Full name', { field: 'Full name', max: 120 });
  const role = await select(
    'Role',
    Object.entries(ROLE_NAMES).map(([value, label]) => ({
      name: `${label} - ${describePermissions(value).join(', ')}`,
      value,
      short: label,
    })),
  );
  const pass = await password('Password (min 8 characters, not echoed)');

  const user = authService.createUser({ username, fullName, password: pass, role }, actor);
  print(success(`User "${user.username}" created with role ${roleLabel(user.role)}.`));
  print(warn('Share the password through a secure channel, and ask the user to change it after first login.'));
}

async function resetPasswordFlow(actor) {
  const user = await pickUser();
  if (!user) return;
  const pass = await password(`New password for ${user.username}`);
  authService.resetPassword(user.id, pass, actor);
  print(success(`Password for "${user.username}" has been reset.`));
}

async function changeRoleFlow(actor) {
  const user = await pickUser();
  if (!user) return;
  const role = await select(
    `New role for ${user.username} (currently ${roleLabel(user.role)})`,
    Object.entries(ROLE_NAMES).map(([value, label]) => ({ name: label, value })),
  );
  const updated = authService.updateUserRole(user.id, role, actor);
  print(success(`${updated.username} is now ${roleLabel(updated.role)}.`));
}

async function toggleActiveFlow(actor) {
  const user = await pickUser();
  if (!user) return;
  const keepActive = await yesNo(`Keep "${user.username}" active?`, { default: user.active === 1 });
  const updated = authService.setActive(user.id, keepActive, actor);
  print(success(`${updated.username} is now ${updated.active === 1 ? 'active' : 'disabled'}.`));
}

async function changeOwnPasswordFlow(actor) {
  const current = await password('Current password');
  const next = await password('New password (min 8 characters)');
  const again = await password('Repeat new password');
  if (next !== again) {
    print(warn('The new passwords do not match. Nothing changed.'));
    return;
  }
  changeOwnPassword(actor, current, next);
  print(success('Your password has been changed.'));
}

async function settingsMenu(actor) {
  await runMenu({
    title: 'Policy settings',
    actor,
    options: [
      {
        label: 'Show current settings',
        value: 'list',
        permission: PERMISSIONS.SETTINGS_MANAGE,
        run: () => {
          print(
            table(settingsService.listSettings(), [
              { key: 'key', header: 'Key' },
              { key: 'value', header: 'Value' },
              { key: 'label', header: 'Description', format: (row) => row.label ?? color.dim('-') },
              { key: 'updated_at', header: 'Updated', format: (row) => dateTime(row.updated_at) },
            ]),
          );
        },
      },
      {
        label: 'Set the first deposit requirement',
        value: 'deposit',
        permission: PERMISSIONS.SETTINGS_MANAGE,
        run: () => setDepositFlow(actor),
      },
      {
        label: 'Set the currency label',
        value: 'currency',
        permission: PERMISSIONS.SETTINGS_MANAGE,
        run: () => setCurrencyFlow(actor),
      },
      {
        label: 'Set the institution name',
        value: 'institution',
        permission: PERMISSIONS.SETTINGS_MANAGE,
        run: () => setInstitutionFlow(actor),
      },
    ],
  });
}

async function setDepositFlow(actor) {
  const current = settingsService.getFirstDepositRequirement();
  const currency = settingsService.getCurrency();
  print(color.dim(`  Current requirement: ${money(current, currency)}.`));
  const value = await amount(`New first deposit requirement (${currency})`, { field: 'Amount', min: 0 });
  const updated = settingsService.setSetting(SETTING_KEYS.FIRST_DEPOSIT_AMOUNT, value, { actor });
  print(success(`First deposit requirement is now ${money(updated.value, currency)}.`));
  print(warn('Changing this immediately changes who is eligible for allocation and check-in.'));
}

async function setCurrencyFlow(actor) {
  const current = settingsService.getCurrency();
  const value = await text('Currency label (e.g. TZS, KES, USD)', { field: 'Currency', default: current, max: 10 });
  settingsService.setSetting(SETTING_KEYS.CURRENCY, value, { actor });
  print(success(`Currency label set to "${value}".`));
}

async function setInstitutionFlow(actor) {
  const current = settingsService.getInstitutionName();
  const value = await text('Institution name', { field: 'Institution name', default: current, max: 80 });
  settingsService.setSetting(SETTING_KEYS.INSTITUTION_NAME, value, { actor });
  print(success(`Institution name set to "${value}".`));
}
