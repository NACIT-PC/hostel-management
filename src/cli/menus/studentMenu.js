import { GENDERS, YEAR_FORMS, HEALTH_REQUIREMENT_CODES, HEALTH_REQUIREMENT_LEVELS } from '../../config.js';
import { PERMISSIONS } from '../../security/permissions.js';
import * as studentService from '../../services/studentService.js';
import * as feeService from '../../services/feeService.js';
import * as allocationService from '../../services/allocationService.js';
import { requirementLabel } from '../../services/matching.js';
import { color, keyValue, print, section, success, table, warn } from '../ui.js';
import { confirm, select, text, yesNo } from '../prompts.js';
import { runMenu, pickStudent } from './common.js';

export async function studentMenu(actor) {
  await runMenu({
    title: 'Students',
    actor,
    options: [
      {
        label: 'List / search students',
        value: 'list',
        permission: PERMISSIONS.STUDENT_MANAGE,
        run: () => listFlow(),
      },
      {
        label: 'View student profile',
        value: 'view',
        permission: PERMISSIONS.STUDENT_MANAGE,
        run: () => viewFlow(actor),
      },
      {
        label: 'Register a new student',
        value: 'register',
        permission: PERMISSIONS.STUDENT_MANAGE,
        run: () => registerFlow(actor),
      },
      {
        label: 'Update student details',
        value: 'update',
        permission: PERMISSIONS.STUDENT_MANAGE,
        run: () => updateFlow(actor),
      },
      {
        label: 'Health: add / update a requirement',
        value: 'health-add',
        permission: PERMISSIONS.STUDENT_MANAGE,
        run: () => addConditionFlow(actor),
      },
      {
        label: 'Health: remove a requirement',
        value: 'health-remove',
        permission: PERMISSIONS.STUDENT_MANAGE,
        run: () => removeConditionFlow(actor),
      },
      {
        label: 'Health: update private notes',
        value: 'health-notes',
        permission: PERMISSIONS.STUDENT_MANAGE,
        run: () => notesFlow(actor),
      },
      {
        label: 'Health: requirements reference',
        value: 'health-reference',
        run: () => {
          print(
            table(
              HEALTH_REQUIREMENT_CODES.map((entry) => ({
                ...entry,
                enforced: entry.enforceable ? color.green('yes') : color.yellow('advisory'),
              })),
              [
                { key: 'code', header: 'Code' },
                { key: 'label', header: 'Meaning' },
                { key: 'enforced', header: 'Auto-matched', format: (row) => row.enforced },
              ],
            ),
          );
          print(
            color.dim(
              '\n  "required" conditions block allocation of unsuitable beds; "preferred" ones only influence ranking.',
            ),
          );
        },
      },
      {
        label: 'Delete / deactivate a student',
        value: 'delete',
        permission: PERMISSIONS.STUDENT_MANAGE,
        run: () => deleteFlow(actor),
      },
    ],
  });
}

async function listFlow() {
  const search = await text('Search by name or Student ID (blank = all)', {
    field: 'Search text',
    optional: true,
    max: 60,
  });
  const filterGender = await select('Gender filter', [
    { name: 'Any', value: null },
    ...GENDERS.map((item) => ({ name: item, value: item })),
  ]);
  const filterYear = await select('Year / form filter', [
    { name: 'Any', value: null },
    ...YEAR_FORMS.map((item) => ({ name: item, value: item })),
  ]);

  const rows = studentService.listStudents({
    search: search ?? null,
    gender: filterGender,
    yearForm: filterYear,
  });
  print(color.bold(`\n${rows.length} student(s)`));
  print(
    table(
      rows.map((row) => ({
        ...row,
        placement: row.hostel_name
          ? `${row.hostel_name} ${row.room_number}/${row.bed_label} (${row.allocation_status})`
          : color.dim('unallocated'),
        needs: row.health_condition_count > 0 || row.has_health_notes ? color.yellow('Yes') : color.dim('No'),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'gender', header: 'Gender' },
        { key: 'year_form', header: 'Year/Form' },
        { key: 'total_paid', header: 'Paid', align: 'right' },
        { key: 'needs', header: 'Needs', format: (row) => row.needs },
        { key: 'placement', header: 'Placement', format: (row) => row.placement },
        {
          key: 'is_active',
          header: 'State',
          format: (row) => (row.is_active === 1 ? color.green('active') : color.yellow('inactive')),
        },
      ],
      { empty: 'No students matched.' },
    ),
  );
}

async function viewFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  let reveal = false;
  if (studentService.canRevealHealth(actor)) {
    const masked = studentService.getHealthProfile(student.id, { reveal: false });
    const hasPrivateDetail =
      masked.health_notes_private || masked.conditions.some((condition) => condition.notes);
    if (hasPrivateDetail) {
      reveal = await yesNo('Reveal private health detail? (this access is logged)', { default: false });
    }
  }

  const health = studentService.getHealthProfile(student.id, { reveal, actor, reason: 'interactive view' });
  const fee = feeService.getFeeSummary(student.id);
  const allocation = allocationService.getActiveAllocation(student.id);
  const summary = studentService.getStudentSummaryRow(student.id);

  print(
    keyValue([
      ['Student ID', summary.student_code],
      ['Name', summary.full_name],
      ['Gender', summary.gender],
      ['Year / Form', summary.year_form],
      ['Phone', summary.phone ?? color.dim('-')],
      ['Email', summary.email ?? color.dim('-')],
      ['Status', summary.is_active === 1 ? color.green('active') : color.yellow('inactive')],
      ['Fees', `${fee.total_paid} of ${fee.required} ${fee.currency} ${fee.meetsRequirement ? color.green('(eligible)') : color.red('(short)')}`],
      [
        'Accommodation',
        allocation
          ? `${allocation.hostel_name} room ${allocation.room_number} bed ${allocation.bed_label} (${allocation.status})`
          : color.dim('unallocated'),
      ],
    ]),
  );

  print(section('Health & sensitivity'));
  if (!health.hasRestrictions) {
    print(color.dim('  Nothing recorded.'));
    return;
  }
  print(`  Private notes: ${health.reveal ? color.yellow(health.health_notes ?? '-') : health.health_notes ? color.yellow('[private - restricted]') : color.dim('-')}`);
  print(
    table(
      health.conditions.map((condition) => ({
        ...condition,
        meaning: requirementLabel(condition.code),
        levelLabel: condition.level === 'required' ? color.red('required') : color.yellow('preferred'),
      })),
      [
        { key: 'id', header: 'ID', align: 'right' },
        { key: 'code', header: 'Code' },
        { key: 'meaning', header: 'Meaning' },
        { key: 'levelLabel', header: 'Level', format: (row) => row.levelLabel },
        {
          key: 'notes',
          header: 'Notes',
          format: (row) => (row.notes ? (health.reveal ? row.notes : color.yellow('[private]')) : color.dim('-')),
        },
      ],
      { empty: 'No structured requirements.' },
    ),
  );
}

async function registerFlow(actor) {
  print(color.dim('  The Student ID is the payer identity used for fee records.'));
  const studentCode = await text('Student ID (e.g. NACIT/2026/014)', { field: 'Student ID', max: 40 });
  const fullName = await text('Full name', { field: 'Student name', max: 120 });
  const gender = await select('Gender', GENDERS.map((item) => ({ name: item, value: item })));
  const yearForm = await select('Year / form', YEAR_FORMS.map((item) => ({ name: item, value: item })));
  const phone = await text('Phone (optional)', { field: 'Phone', optional: true, max: 20 });
  const email = await text('Email (optional)', { field: 'Email', optional: true, max: 80 });
  const healthNotes = await text(
    'Private health / sensitivity notes (optional, stored encrypted-at-rest by access control only)',
    { field: 'Health notes', optional: true, max: 1000 },
  );

  const student = studentService.registerStudent(
    { studentCode, fullName, gender, yearForm, phone, email, healthNotes },
    actor,
  );
  print(success(`Student ${student.student_code} registered.`));
  if (healthNotes) {
    print(
      color.dim(
        '  Private notes recorded. They are visible only to roles with the health.reveal permission, and every reveal is logged.',
      ),
    );
  }
  if (!healthNotes) {
    print(color.dim('  Tip: use "Health: add / update a requirement" to record matchable (medical) needs.'));
  }
}

async function updateFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const field = await select('What do you want to change?', [
    { name: 'Name', value: 'fullName' },
    { name: 'Gender', value: 'gender' },
    { name: 'Year / form', value: 'yearForm' },
    { name: 'Phone', value: 'phone' },
    { name: 'Email', value: 'email' },
    { name: 'Active / inactive (leave)', value: 'isActive' },
  ]);

  const changes = {};
  if (field === 'fullName') changes.fullName = await text('New name', { field: 'Student name', default: student.full_name, max: 120 });
  if (field === 'gender') changes.gender = await select('New gender', GENDERS.map((item) => ({ name: item, value: item })));
  if (field === 'yearForm') changes.yearForm = await select('New year / form', YEAR_FORMS.map((item) => ({ name: item, value: item })));
  if (field === 'phone') changes.phone = await text('New phone', { field: 'Phone', default: student.phone ?? '', optional: true, max: 20 });
  if (field === 'email') changes.email = await text('New email', { field: 'Email', default: student.email ?? '', optional: true, max: 80 });
  if (field === 'isActive') changes.isActive = await yesNo('Keep this student active?', { default: student.is_active === 1 });

  const updated = studentService.updateStudent(student.id, changes, actor);
  print(success(`${updated.student_code} updated.`));
  if (['gender', 'yearForm', 'isActive'].includes(field)) {
    print(warn('If this student already has a bed, verify the placement is still valid (Reports > Students by room).'));
  }
}

async function addConditionFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const code = await select(
    'Requirement',
    HEALTH_REQUIREMENT_CODES.map((entry) => ({ name: `${entry.code} - ${entry.label}`, value: entry.code })),
  );
  const level = await select(
    'How strict is it?',
    [
      { name: 'Required - must never be violated', value: 'required' },
      { name: 'Preferred - try to honour it', value: 'preferred' },
    ],
  );
  const notes = await text('Private note for this condition (optional)', {
    field: 'Condition notes',
    optional: true,
    max: 500,
  });

  studentService.addHealthCondition({ studentIdentifier: student.id, code, level, notes }, actor);
  print(success(`Requirement ${code} (${level}) recorded for ${student.student_code}.`));
  if (HEALTH_REQUIREMENT_CODES.find((entry) => entry.code === code)?.enforceable === false) {
    print(warn('This code is advisory: the allocator will not filter beds, but the note is kept private.'));
  }
  if (level === 'required') {
    print(
      color.dim(
        '  Auto-allocation and manual assignment will now refuse any bed that does not satisfy this requirement.',
      ),
    );
  }
}

async function removeConditionFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const conditions = studentService.getRequirements(student.id);
  if (!conditions.length) {
    print(warn('This student has no structured requirements.'));
    return;
  }
  const conditionId = await select(
    'Requirement to remove',
    conditions.map((condition) => ({
      name: `${condition.code} (${condition.level}) - ${requirementLabel(condition.code)}`,
      value: condition.id,
    })),
  );
  if (!(await confirm('Remove this requirement?', false))) {
    print(color.dim('Cancelled.'));
    return;
  }
  studentService.removeHealthCondition(conditionId, actor);
  print(success('Requirement removed.'));
}

async function notesFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const mode = await select('Private health notes', [
    { name: 'Set / replace the private notes', value: 'set' },
    { name: 'Clear the private notes', value: 'clear' },
  ]);

  if (mode === 'clear') {
    if (!(await confirm('Clear the stored private notes for this student?', false))) {
      print(color.dim('Cancelled.'));
      return;
    }
    studentService.setHealthNotes(student.id, null, actor);
    print(success('Private notes cleared.'));
    return;
  }

  print(color.dim('  Stored content is never echoed back on screen.'));
  const notes = await text('New private notes (e.g. medical detail for the warden)', {
    field: 'Health notes',
    max: 1000,
  });
  studentService.setHealthNotes(student.id, notes, actor);
  print(success('Private notes saved.'));
}

async function deleteFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const mode = await select('What do you want to do?', [
    {
      name: 'Deactivate (keeps history - recommended)',
      value: 'deactivate',
    },
    { name: 'Delete permanently (only if no history)', value: 'delete' },
  ]);

  if (mode === 'deactivate') {
    if (!(await confirm(`Mark ${student.student_code} as inactive?`, true))) {
      print(color.dim('Cancelled.'));
      return;
    }
    studentService.updateStudent(student.id, { isActive: false }, actor);
    print(success(`${student.student_code} deactivated.`));
    return;
  }

  if (!(await confirm('Permanently delete this student record?', false))) {
    print(color.dim('Cancelled.'));
    return;
  }
  studentService.deleteStudent(student.id, actor);
  print(success(`${student.student_code} deleted.`));
}
