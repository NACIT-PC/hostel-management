/**
 * Session handling for the interactive CLI: login, logout and first-run setup.
 */
import * as authService from '../services/authService.js';
import { getInstitutionName } from '../services/settingsService.js';
import { assertPermission, can, describePermissions, PERMISSIONS } from '../security/permissions.js';
import { roleLabel } from '../services/authService.js';
import { color, heading, success, warn, failure, print } from './ui.js';
import { pause, password, select, text } from './prompts.js';
import { asPassword } from '../utils/validate.js';

let currentUser = null;

export function getUser() {
  return currentUser;
}

export function isSignedIn() {
  return currentUser !== null;
}

export function setUser(user) {
  currentUser = user;
}

export function signOut() {
  currentUser = null;
}

export function canDo(permission) {
  return can(currentUser?.role, permission);
}

export function requirePermission(permission) {
  return assertPermission(currentUser, permission);
}

export { PERMISSIONS, roleLabel, describePermissions, can };

/** Create the first administrator when the database has no users at all. */
export async function firstRunSetup() {
  print(heading('First run - create the administrator account'));
  if (authService.countUsers() > 0) return null;

  print(
    color.dim(
      '  No system users exist yet. Create the administrator account that will manage\n  hostels, students, fees and other users.',
    ),
  );

  const username = await text('Administrator username', { field: 'Username', max: 40 });
  const fullName = await text('Full name', { field: 'Full name', max: 120 });
  const pass = await asPasswordPrompt('Password (min 8 characters)');
  const again = await password('Repeat password');

  if (pass !== again) {
    print(failure('Passwords do not match. Please try again.'));
    return firstRunSetup();
  }

  const user = authService.createUser(
    { username, fullName, password: pass, role: 'admin' },
    null,
  );
  print(success(`Administrator "${user.username}" created.`));
  await pause();
  return user;
}

async function asPasswordPrompt(message) {
  while (true) {
    const value = await password(message);
    try {
      return asPassword(value, 'Password');
    } catch (error) {
      print(failure(error.message));
    }
  }
}

/**
 * Interactive login. Returns the authenticated user, or null when the user
 * chooses to quit (including after too many failed attempts).
 */
export async function login({ maxAttempts = 3 } = {}) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    print(heading('Sign in'));
    const username = await text(`Username ${color.dim('(or "exit" to quit)')}`, {
      field: 'Username',
      max: 40,
    });
    if (String(username).toLowerCase() === 'exit') return null;

    const pass = await password('Password');

    let user;
    try {
      user = authService.authenticate(username, pass);
    } catch (error) {
      print(failure(error.message));
      return null;
    }

    if (user) {
      currentUser = user;
      print(success(`Welcome, ${user.full_name} (${roleLabel(user.role)}).`));
      return user;
    }

    attempts += 1;
    print(
      failure(
        `Invalid username or password. Attempt ${attempts} of ${maxAttempts}.`,
      ),
    );
  }

  print(warn('Too many failed attempts. The application will now close for safety.'));
  return null;
}

/** Minimal bootstrap helper for command-line (non-interactive) usage. */
export function describeRole(user) {
  return `${roleLabel(user.role)}: ${describePermissions(user.role).join(', ')}`;
}

/** Startup choice: sign in, create an account, or leave. */
export async function chooseAction() {
  const message =
    authService.countUsers() === 0
      ? 'No accounts yet - choose "Sign up" to create the administrator'
      : 'Sign in or sign up';
  return select(message, [
    { name: 'Sign in', value: 'signin' },
    { name: 'Sign up', value: 'signup' },
    { name: color.dim('Exit'), value: 'exit' },
  ]);
}

/**
 * Create an account. The first account is the administrator; afterwards anyone
 * can sign up (self-service).
 * @returns {Promise<boolean>} true when an account was created.
 */
export async function signUp() {
  if (authService.countUsers() === 0) {
    const created = await firstRunSetup();
    return created !== null;
  }

  print(heading('Sign up'));

  const username = await text('Username', { field: 'Username', max: 40 });
  const fullName = await text('Full name', { field: 'Full name', max: 120 });
  const role = await select('Role for the new account', [
    { name: `${roleLabel('admin')} - full access`, value: 'admin' },
    { name: `${roleLabel('warden')} - hostels, allocation and stays`, value: 'warden' },
    { name: `${roleLabel('clerk')} - front desk`, value: 'clerk' },
  ]);
  const pass = await asPasswordPrompt('Password (min 8 characters)');
  const again = await password('Repeat password');

  if (pass !== again) {
    print(failure('Passwords do not match. Nothing was created.'));
    return false;
  }

  try {
    const user = authService.createUser({ username, fullName, password: pass, role }, null, {
      selfService: true,
    });
    print(success(`Account "${user.username}" created. You can now sign in.`));
    await pause();
    return true;
  } catch (error) {
    print(failure(error.message));
    return false;
  }
}

export function institution() {
  try {
    return getInstitutionName();
  } catch (error) {
    return null;
  }
}
