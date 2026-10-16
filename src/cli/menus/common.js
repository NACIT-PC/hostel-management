import { can, PERMISSIONS } from '../../security/permissions.js';
import * as studentService from '../../services/studentService.js';
import * as hostelService from '../../services/hostelService.js';
import { color, print, printError, heading } from '../ui.js';
import { pause, select, text, PromptExit } from '../prompts.js';

export const BACK = '__back__';

export async function runMenu({ title, actor, options, footer = '<< Back' }) {
  for (;;) {
    const available = options.filter((option) => !option.permission || can(actor.role, option.permission));

    print(heading(title));
    const choice = await select(
      'Choose an action',
      [
        ...available.map((option) => ({ name: option.label, value: option.value, short: option.label })),
        { name: color.dim(footer), value: BACK },
      ],
      { pageSize: 20 },
    );

    if (choice === BACK) return;

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

export async function pickStudent({ message = 'Find student (name or Student ID)' } = {}) {
  const term = await text(message, { field: 'Search text', max: 60 });
  let rows;
  try {
    rows = studentService.listStudents({ search: term });
  } catch (error) {
    printError(error);
    return null;
  }

  if (!rows.length) {
    print(color.yellow(`[!] No student matched "${term}".`));
    return null;
  }
  if (rows.length === 1) return studentService.resolveStudent(rows[0].student_code);

  const choice = await select(
    'Select student',
    rows.slice(0, 80).map((row) => ({
      name: `${row.student_code} - ${row.full_name} ${color.dim(`(${row.gender}, ${row.year_form})`)}`,
      value: row.student_code,
      short: row.student_code,
    })),
  );
  return studentService.resolveStudent(choice);
}

export async function pickHostel({ message = 'Select hostel', allowAll = false } = {}) {
  const hostels = hostelService.listHostels();
  if (!hostels.length) {
    print(color.yellow('[!] No hostels registered yet. Register a hostel first.'));
    return null;
  }
  const choices = hostels.map((hostel) => ({
    name: `${hostel.name} ${color.dim(`(${hostelService.hostelRuleText(hostel)}) - ${hostel.free_beds} free bed(s)`)}`,
    value: hostel.id,
    short: hostel.name,
  }));
  if (allowAll) choices.unshift({ name: 'All hostels', value: 'all', short: 'All' });

  const choice = await select(message, choices);
  if (choice === 'all') return 'all';
  return hostelService.getHostel(choice);
}

export { PERMISSIONS, can };
