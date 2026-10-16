import { ensureDatabase } from '../db/connection.js';
import { setSetting, getFirstDepositRequirement, getCurrency, getInstitutionName } from '../services/settingsService.js';
import { changeOwnPassword, roleLabel } from '../services/authService.js';
import { dashboard } from '../services/reportService.js';
import { SETTING_KEYS } from '../config.js';
import { can, PERMISSIONS } from '../security/permissions.js';
import { asAmount, asPassword } from '../utils/validate.js';
import { banner, color, heading, print, printError, success, warn } from './ui.js';
import { amount, password, select, pause, PromptExit, text } from './prompts.js';
import * as session from './session.js';
import { hostelMenu } from './menus/hostelMenu.js';
import { studentMenu } from './menus/studentMenu.js';
import { feeMenu } from './menus/feeMenu.js';
import { allocationMenu } from './menus/allocationMenu.js';
import { stayMenu } from './menus/stayMenu.js';
import { reportMenu } from './menus/reportMenu.js';
import { adminMenu } from './menus/adminMenu.js';

const LOGOUT = '__logout__';
const EXIT = '__exit__';

export async function runInteractive() {
  ensureDatabase();

  try {
    for (;;) {
      const action = await session.chooseAction();
      if (action === 'exit') return 0;

      if (action === 'signup') {
        await session.signUp();
        continue;
      }

      const user = await session.login();
      if (!user) return 0;

      const signedOut = await mainMenu(user);
      if (!signedOut) return 0;

      session.signOut();
      print(color.dim('\n  Signed out.'));
    }
  } catch (error) {
    if (error instanceof PromptExit) {
      print(color.dim('\n  Aborted. Goodbye.'));
      return 130;
    }
    printError(error);
    return 1;
  }
}

async function mainMenu(user) {
  const options = [
    { label: 'Dashboard', value: 'dashboard', permission: PERMISSIONS.REPORT_VIEW, run: showDashboard },
    {
      label: 'Hostel inventory (hostels, rooms, beds)',
      value: 'hostels',
      permission: PERMISSIONS.REPORT_VIEW,
      run: () => hostelMenu(user),
    },
    {
      label: 'Students (registration, health/sensitivity)',
      value: 'students',
      permission: PERMISSIONS.STUDENT_MANAGE,
      run: () => studentMenu(user),
    },
    {
      label: 'Fees (deposits, eligibility)',
      value: 'fees',
      permission: PERMISSIONS.FEE_MANAGE,
      run: () => feeMenu(user),
    },
    {
      label: 'Bed allocation (eligibility, assign)',
      value: 'allocation',
      permission: PERMISSIONS.ALLOCATION_MANAGE,
      run: () => allocationMenu(user),
    },
    {
      label: 'Check-in / Check-out',
      value: 'stay',
      permission: PERMISSIONS.STAY_MANAGE,
      run: () => stayMenu(user),
    },
    {
      label: 'Availability & reports',
      value: 'reports',
      permission: PERMISSIONS.REPORT_VIEW,
      run: () => reportMenu(user),
    },
    {
      label: 'Administration (users, settings, audit)',
      value: 'admin',
      permission: PERMISSIONS.USER_MANAGE,
      run: async () => {
        await adminMenu(user);
        return false;
      },
    },
    { label: 'Change my password', value: 'password', run: () => changePasswordFlow(user) },
  ];

  for (;;) {
    const available = options.filter((option) => !option.permission || can(user.role, option.permission));

    banner({ user });
    print(color.dim(`\n  Role: ${roleLabel(user.role)}`));

    const choice = await select(
      'Main menu',
      [
        ...available.map((option) => ({ name: option.label, value: option.value, short: option.label })),
        { name: color.dim('Sign out'), value: LOGOUT },
        { name: color.dim('Exit application'), value: EXIT },
      ],
      { pageSize: 20 },
    );

    if (choice === LOGOUT) return true;
    if (choice === EXIT) return false;

    const option = available.find((item) => item.value === choice);
    if (!option) continue;

    try {
      const pauseAfter = await option.run();
      if (pauseAfter !== false) await pause();
    } catch (error) {
      if (error instanceof PromptExit) throw error;
      printError(error);
      await pause();
    }
  }
}

function showDashboard() {
  const data = dashboard();
  print(`\n${color.bold(data.institution)}`);
  print(
    [
      `  Hostels         : ${data.hostels} (${data.rooms} rooms, ${data.beds} beds)`,
      `  Active students : ${data.students}`,
      `  Checked in      : ${color.green(String(data.checked_in))}`,
      `  Awaiting arrival: ${color.yellow(String(data.assigned))}`,
      `  Free beds       : ${data.freeBeds} / ${data.beds}  (${data.utilisation}% occupied)`,
      `  Fees collected  : ${data.fees_collected} ${data.currency}`,
      `  Deposit policy  : ${data.firstDepositRequirement} ${data.currency}`,
    ].join('\n'),
  );
}

async function changePasswordFlow(user) {
  const current = await password('Current password');
  const next = await password('New password (min 8 characters)');
  const again = await password('Repeat new password');
  if (next !== again) {
    print(warn('The new passwords do not match. Nothing changed.'));
    return;
  }
  changeOwnPassword(user, current, asPassword(next, 'New password'));
  print(success('Your password has been changed.'));
}

export async function quickSetup(actor) {
  const currency = getCurrency();
  print(heading('Quick setup'));
  print(`  Current first deposit requirement: ${getFirstDepositRequirement()} ${currency}`);
  const value = await amount(`First deposit requirement (${currency})`, { field: 'Amount', min: 0 });
  setSetting(SETTING_KEYS.FIRST_DEPOSIT_AMOUNT, String(asAmount(value, 'Amount', { min: 0 })), { actor });
  const institution = await text('Institution name', {
    field: 'Institution name',
    default: getInstitutionName(),
    max: 80,
  });
  setSetting(SETTING_KEYS.INSTITUTION_NAME, institution, { actor });
  print(success('Setup saved.'));
}
