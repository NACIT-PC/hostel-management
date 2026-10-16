import { PERMISSIONS, can } from '../../security/permissions.js';
import * as stayService from '../../services/stayService.js';
import * as allocationService from '../../services/allocationService.js';
import * as studentService from '../../services/studentService.js';
import * as feeService from '../../services/feeService.js';
import { color, keyValue, money, print, section, success, table, warn } from '../ui.js';
import { confirm, select, text } from '../prompts.js';
import { runMenu, pickHostel, pickStudent } from './common.js';

export async function stayMenu(actor) {
  await runMenu({
    title: 'Check-in / Check-out',
    actor,
    options: [
      {
        label: 'Check a student in',
        value: 'in',
        permission: PERMISSIONS.STAY_MANAGE,
        run: () => checkInFlow(actor),
      },
      {
        label: 'Check a student out',
        value: 'out',
        permission: PERMISSIONS.STAY_MANAGE,
        run: () => checkOutFlow(actor),
      },
      {
        label: 'Current residents',
        value: 'residents',
        permission: PERMISSIONS.STAY_MANAGE,
        run: () => residentsFlow(),
      },
      {
        label: 'Movement log (recent check-ins / check-outs)',
        value: 'logs',
        permission: PERMISSIONS.STAY_MANAGE,
        run: () => logsFlow(),
      },
      {
        label: 'A student\'s stay history',
        value: 'history',
        permission: PERMISSIONS.STAY_MANAGE,
        run: () => historyFlow(),
      },
    ],
  });
}

async function checkInFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const allocation = allocationService.getActiveAllocation(student.id);
  if (!allocation) {
    print(warn('This student has no bed assigned. Use "Bed allocation" first.'));
    return;
  }

  print(
    keyValue([
      ['Student', `${allocation.student_code} - ${allocation.student_name ?? student.full_name}`],
      ['Hostel', allocation.hostel_name],
      ['Room / Bed', `${allocation.room_number} / ${allocation.bed_label}`],
      ['Allocation status', allocation.status],
    ]),
  );

  if (allocation.status === 'checked_in') {
    print(warn('This student is already checked in.'));
    return;
  }

  const fee = feeService.getFeeSummary(student.id);
  const feeOk = fee.meetsRequirement;
  print(
    `  Fee position: ${money(fee.total_paid, fee.currency)} of ${money(fee.required, fee.currency)} - ${
      feeOk ? color.green('eligible') : color.red('incomplete')
    }`,
  );

  let allowIneligible = false;
  if (!feeOk) {
    if (!can(actor.role, PERMISSIONS.HOSTEL_MANAGE)) {
      print(
        color.red(
          '  The fee deposit requirement is not met and your role may not override it. Collect the deposit first.',
        ),
      );
      return;
    }
    const proceed = await confirm(
      'Fee deposit is incomplete. Check this student in with a zomwe mukufuna override?',
      false,
    );
    if (!proceed) {
      print(color.dim('Cancelled.'));
      return;
    }
    allowIneligible = true;
  }

  const note = await text('Check-in note (optional: key returned, luggage, ...)', {
    field: 'Note',
    optional: true,
    max: 200,
  });

  const result = stayService.checkIn(allocation.id, actor, { allowIneligible, note });
  print(
    success(
      `Checked in ${result.student_code} at ${result.hostel_name} room ${result.room_number}, bed ${result.bed_label}.`,
    ),
  );
  if (allowIneligible) {
    print(warn('This check-in was recorded as a zomwe mukufuna override (fee deposit incomplete).'));
  }
}

async function checkOutFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const allocation = allocationService.getActiveAllocation(student.id);
  if (!allocation) {
    print(warn('This student has no active allocation.'));
    return;
  }

  print(
    keyValue([
      ['Student', `${allocation.student_code} - ${allocation.student_name ?? student.full_name}`],
      ['Hostel', allocation.hostel_name],
      ['Room / Bed', `${allocation.room_number} / ${allocation.bed_label}`],
      ['Status', allocation.status],
      ['Checked in', allocation.checked_in_at ?? color.dim('-')],
    ]),
  );

  const cancelInstead = allocation.status === 'assigned';
  if (cancelInstead) {
    print(warn('This student was never checked in - the assignment will be cancelled and the bed released.'));
  }

  const note = await text('Check-out note (optional: bed condition, key returned, ...)', {
    field: 'Note',
    optional: true,
    max: 200,
  });

  if (!(await confirm(cancelInstead ? 'Cancel the assignment?' : 'Confirm check-out?', true))) {
    print(color.dim('Cancelled.'));
    return;
  }

  const result = stayService.checkOut(allocation.id, actor, { note, cancelIfAssigned: true });
  print(
    success(
      cancelInstead
        ? `Assignment cancelled; bed ${result.room_number}/${result.bed_label} is free again.`
        : `Checked out ${result.student_code}; bed ${result.room_number}/${result.bed_label} is free again.`,
    ),
  );
}

async function residentsFlow() {
  const scope = await select('Scope', [
    { name: 'All hostels', value: 'all' },
    { name: 'One hostel', value: 'one' },
  ]);

  let hostelIdentifier = null;
  if (scope === 'one') {
    const hostel = await pickHostel();
    if (!hostel) return;
    hostelIdentifier = hostel.id;
  }

  const includeAssigned = await confirm('Include students who are assigned but not yet checked in?', false);
  const rows = stayService.currentResidents({
    hostelId: hostelIdentifier,
    assignedOnly: includeAssigned,
  });

  print(color.bold(`\n${rows.length} occupant(s)`));
  print(
    table(
      rows.map((row) => ({
        ...row,
        status: row.status === 'checked_in' ? color.green('checked in') : color.yellow('assigned'),
        since: row.checked_in_at ?? row.assigned_at,
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'student_name', header: 'Name' },
        { key: 'gender', header: 'Gender' },
        { key: 'year_form', header: 'Year/Form' },
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'status', header: 'Status', format: (row) => row.status },
        { key: 'since', header: 'Since', format: (row) => row.since ?? color.dim('-') },
      ],
      { empty: 'Nobody is currently checked in.' },
    ),
  );
}

async function logsFlow() {
  const rows = stayService.listStayLogs({ limit: 50 });
  print(
    table(
      rows.map((row) => ({
        ...row,
        action: row.action === 'checked_in' ? color.green('checked in') : row.action === 'checked_out' ? color.yellow('checked out') : color.dim('cancelled'),
      })),
      [
        { key: 'id', header: 'ID', align: 'right' },
        { key: 'at', header: 'When' },
        { key: 'action', header: 'Action', format: (row) => row.action },
        { key: 'student_code', header: 'Student ID' },
        { key: 'student_name', header: 'Name' },
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'actor', header: 'By' },
      ],
      { empty: 'No movements recorded yet.' },
    ),
  );
}

async function historyFlow() {
  const student = await pickStudent();
  if (!student) return;

  const history = stayService.studentStayHistory(student.id);
  print(section(`Stay history for ${student.student_code} - ${student.full_name}`));
  print(
    table(
      history.map((row) => ({
        ...row,
        status: row.status === 'checked_in'
          ? color.green('checked in')
          : row.status === 'assigned'
            ? color.yellow('assigned')
            : row.status === 'checked_out'
              ? color.dim('checked out')
              : color.dim('cancelled'),
      })),
      [
        { key: 'id', header: 'Alloc #', align: 'right' },
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'status', header: 'Status', format: (row) => row.status },
        { key: 'assigned_at', header: 'Assigned' },
        { key: 'checked_in_at', header: 'In' },
        { key: 'checked_out_at', header: 'Out' },
      ],
      { empty: 'No allocation history.' },
    ),
  );
}
