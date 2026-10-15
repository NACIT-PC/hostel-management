/**
 * Presentation layer for the CLI: one place that knows how each domain object
 * should look on screen. Services return plain rows; this module formats them.
 */
import { color, table, keyValue, money, dateTime, heading, section, bullet, success, warn, failure, info, sensitive } from '../utils/format.js';
import { describeCategory, hostelRuleText } from '../services/hostelService.js';
import { requirementLabel } from '../services/matching.js';
import { roleLabel, canRevealHealth } from '../services/index.js';
import { isAppError } from '../utils/errors.js';

export { heading, section, bullet, success, warn, failure, info, color, money, dateTime, table, keyValue, sensitive };

export function print(line = '') {
  process.stdout.write(`${line}\n`);
}

export function printError(error) {
  if (isAppError(error)) {
    print(`\n${failure(error.message)}`);
    for (const detail of error.details ?? []) print(`   ${color.dim(`- ${detail}`)}`);
    return;
  }
  print(`\n${failure(`Unexpected error: ${error?.message ?? error}`)}`);
  if (process.env.HOSTEL_DEBUG) print(color.dim(error?.stack ?? ''));
}

/* ------------------------------------------------------------------ */
/* Banners                                                             */
/* ------------------------------------------------------------------ */

export function banner({ institution, user }) {
  const title = institution ? `${institution} - Hostel Bed Allocation` : 'Hostel Bed Allocation System';
  print(color.bold(color.cyan(`\n${'='.repeat(62)}`)));
  print(color.bold(color.cyan(`  ${title}`)));
  if (user) {
    print(
      color.dim(
        `  Signed in as ${user.full_name} <${user.username}> - ${roleLabel(user.role)}${
          canRevealHealth(user) ? '' : ' (health details restricted)'
        }`,
      ),
    );
  }
  print(color.bold(color.cyan(`${'='.repeat(62)}`)));
}

/* ------------------------------------------------------------------ */
/* Hostels / rooms / beds                                              */
/* ------------------------------------------------------------------ */

export function printHostels(rows) {
  print(
    table(rows, [
      { key: 'id', header: 'ID', align: 'right' },
      { key: 'name', header: 'Hostel' },
      {
        key: 'gender',
        header: 'Gender',
        format: (row) => (row.gender === 'Mixed' ? 'Mixed' : `${row.gender} only`),
      },
      {
        key: 'category',
        header: 'Year/Form',
        format: (row) => (row.category === 'ALL' ? 'All' : row.category),
      },
      { key: 'actual_rooms', header: 'Rooms', align: 'right' },
      { key: 'actual_beds', header: 'Beds', align: 'right' },
      { key: 'occupied_beds', header: 'Occ.', align: 'right' },
      { key: 'free_beds', header: 'Free', align: 'right' },
      {
        key: 'utilisation',
        header: 'Use %',
        align: 'right',
        format: (row) =>
          Number(row.actual_beds) > 0
            ? String(Math.round((Number(row.occupied_beds) / Number(row.actual_beds)) * 1000) / 10)
            : '0',
      },
    ]),
  );
}

export function printRooms(rows, { withHostel = false } = {}) {
  const columns = [];
  if (withHostel) columns.push({ key: 'hostel_name', header: 'Hostel' });
  columns.push(
    { key: 'room_number', header: 'Room' },
    { key: 'floor', header: 'Floor', align: 'right', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
    { key: 'capacity', header: 'Cap.', align: 'right' },
    { key: 'bed_count', header: 'Beds', align: 'right' },
    { key: 'occupied_beds', header: 'Occupied', align: 'right' },
    {
      key: 'free_beds',
      header: 'Free',
      align: 'right',
      format: (row) => Number(row.bed_count) - Number(row.occupied_beds),
    },
    { key: 'amenities', header: 'Amenities', format: (row) => row.amenities || color.dim('-') },
    {
      key: 'is_available',
      header: 'State',
      format: (row) => (row.is_available === 1 ? color.green('open') : color.yellow('closed')),
    },
  );
  print(table(rows, columns));
}

export function printBeds(rows) {
  print(
    table(
      rows.map((row) => ({
        ...row,
        state: row.is_occupied
          ? `${color.red('occupied')} ${color.dim(`by ${row.student_code}`)}`
          : row.bed_enabled === 1
            ? color.green('free')
            : color.yellow('disabled'),
      })),
      [
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'bunk_level', header: 'Bunk' },
        { key: 'floor', header: 'Floor', align: 'right', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
        { key: 'state', header: 'Status', format: (row) => row.state },
      ],
    ),
  );
}

export function printBedSearchResults(rows) {
  print(
    table(rows, [
      { key: 'bed_id', header: 'Bed ID', align: 'right' },
      { key: 'hostel_name', header: 'Hostel' },
      { key: 'room_number', header: 'Room' },
      { key: 'bed_label', header: 'Bed' },
      { key: 'bunk_level', header: 'Bunk' },
      { key: 'floor', header: 'Floor', align: 'right', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
      { key: 'room_capacity', header: 'Room size', align: 'right' },
      { key: 'amenities', header: 'Amenities', format: (row) => row.amenities || color.dim('-') },
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Students                                                            */
/* ------------------------------------------------------------------ */

export function printStudents(rows) {
  print(
    table(
      rows.map((row) => ({
        ...row,
        placement: row.allocation_id
          ? `${row.hostel_name} ${row.room_number}/${row.bed_label} ${color.dim(`(${row.allocation_status})`)}`
          : color.dim('unallocated'),
        needs: row.health_condition_count > 0 || row.has_health_notes ? color.yellow('Yes') : color.dim('No'),
        state: row.is_active === 1 ? color.green('active') : color.yellow('inactive'),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'gender', header: 'Gender' },
        { key: 'year_form', header: 'Year/Form' },
        { key: 'total_paid', header: 'Paid', align: 'right', format: (row) => money(row.total_paid, '') },
        { key: 'needs', header: 'Needs', format: (row) => row.needs },
        { key: 'placement', header: 'Placement', format: (row) => row.placement },
        { key: 'state', header: 'State', format: (row) => row.state },
      ],
    ),
  );
}

export function printStudentProfile({ summary, health, fee, allocation }) {
  print(
    keyValue([
      ['Student ID', summary.student_code],
      ['Name', summary.full_name],
      ['Gender', summary.gender],
      ['Year / Form', summary.year_form],
      ['Phone', summary.phone ?? color.dim('-')],
      ['Email', summary.email ?? color.dim('-')],
      ['Status', summary.is_active === 1 ? color.green('active') : color.yellow('inactive')],
      ['Registered', dateTime(summary.created_at)],
    ]),
  );

  print(section('Fees'));
  print(
    keyValue([
      ['Total paid', money(fee.total_paid, fee.currency)],
      ['Required (first deposit)', money(fee.required, fee.currency)],
      ['Eligible on fees', fee.meetsRequirement ? color.green('Yes') : color.red(`No (${money(fee.balance, fee.currency)} short)`)],
      ['Payments recorded', String(fee.payment_count)],
    ]),
  );

  print(section('Accommodation'));
  if (allocation) {
    print(
      keyValue([
        ['Hostel', allocation.hostel_name],
        ['Room / Bed', `${allocation.room_number} / ${allocation.bed_label}`],
        ['Status', allocation.status],
        ['Assigned', dateTime(allocation.assigned_at)],
        ['Checked in', dateTime(allocation.checked_in_at)],
      ]),
    );
  } else {
    print(color.dim('  No active allocation.'));
  }

  print(section('Health & sensitivity (private)'));
  if (!health.hasRestrictions) {
    print(color.dim('  No conditions or private notes recorded.'));
    return;
  }
  const showDetail = health.reveal;
  print(
    showDetail
      ? color.yellow('  Private detail is being displayed. This access has been written to the audit trail.')
      : color.dim('  Showing that special needs exist, without medical detail.'),
  );
  print(`  Private notes      : ${sensitive(health.health_notes, showDetail)}`);
  if (health.conditions.length === 0) {
    print(color.dim('  No structured requirements recorded.'));
  } else {
    print(
      table(
        health.conditions.map((condition) => ({
          ...condition,
          description: requirementLabel(condition.code),
          level: condition.level === 'required' ? color.red('required') : color.yellow('preferred'),
        })),
        [
          { key: 'id', header: 'ID', align: 'right' },
          { key: 'code', header: 'Code' },
          { key: 'description', header: 'Meaning' },
          { key: 'level', header: 'Level', format: (row) => row.level },
          { key: 'notes', header: 'Notes', format: (row) => sensitive(row.notes, showDetail) },
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Fees                                                                */
/* ------------------------------------------------------------------ */

export function printPayments(rows, currency) {
  print(
    table(rows, [
      { key: 'id', header: 'ID', align: 'right' },
      { key: 'paid_on', header: 'Date' },
      { key: 'amount', header: 'Amount', align: 'right', format: (row) => money(row.amount, currency) },
      { key: 'fee_type', header: 'Type' },
      { key: 'method', header: 'Method' },
      { key: 'reference', header: 'Reference', format: (row) => row.reference ?? color.dim('-') },
      { key: 'recorded_by', header: 'Recorded by' },
    ]),
  );
}

export function printFeeSummary(summary) {
  print(
    keyValue([
      ['Total paid', money(summary.total_paid, summary.currency)],
      ['First deposit required', money(summary.required, summary.currency)],
      [
        'Eligibility',
        summary.meetsRequirement
          ? color.green('ELIGIBLE (deposit satisfied)')
          : color.red(`NOT ELIGIBLE (${money(summary.balance, summary.currency)} outstanding)`),
      ],
      ['Payments recorded', String(summary.payment_count)],
      ['First payment on', summary.first_deposit_on ?? color.dim('-')],
    ]),
  );
}

export function printFeeStatusReport(rows, currency) {
  print(
    table(
      rows.map((row) => ({
        ...row,
        status: row.meetsRequirement ? color.green('eligible') : color.red(`short ${money(row.shortfall, currency)}`),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'year_form', header: 'Year/Form' },
        { key: 'total_paid', header: 'Paid', align: 'right', format: (row) => money(row.total_paid, currency) },
        {
          key: 'required',
          header: 'Required',
          align: 'right',
          format: (row) => money(row.required, currency),
        },
        { key: 'status', header: 'Status', format: (row) => row.status },
      ],
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

export function printEligibilityVerdict(verdict) {
  const { student, fee, requirements, hostels, placeable } = verdict;
  print(
    `${color.bold(student.full_name)} ${color.dim(`(${student.student_code}, ${student.gender}, ${student.year_form})`)}`,
  );
  print(
    `Overall: ${
      verdict.eligible ? color.green('ELIGIBLE for allocation') : color.red('NOT ELIGIBLE')
    }${verdict.eligible ? color.dim(` - ${placeable.length} hostel(s) have a suitable free bed`) : ''}`,
  );
  if (verdict.reasons.length) {
    for (const reason of verdict.reasons) print(`  ${color.red('x')} ${reason}`);
  }
  print(
    `  Fees: ${money(fee.total_paid, fee.currency)} of ${money(fee.required, fee.currency)} ${
      fee.meetsRequirement ? color.green('(ok)') : color.red('(short)')
    }`,
  );

  if (requirements.length) {
    print('  Recorded requirements:');
    for (const requirement of requirements) {
      print(
        `    - ${requirement.code} (${requirement.level})${color.dim(` - ${requirementLabel(requirement.code)}`)}`,
      );
    }
  }

  print(section('Hostel by hostel'));
  for (const entry of hostels) {
    const verdictLabel = entry.eligible ? color.green('OK') : color.red('NO');
    print(
      `\n  ${verdictLabel} ${color.bold(entry.hostel.name)} ${color.dim(`(${hostelRuleText(entry.hostel)})`)} - ${entry.hostel.free_beds ?? entry.freeBeds} free bed(s)`,
    );
    for (const check of entry.checks) {
      print(`      ${check.ok ? color.green('+') : color.red('-')} ${check.label}: ${color.dim(check.detail)}`);
    }
    if (entry.bestBeds?.length) {
      const best = entry.bestBeds
        .map((bed) => `${bed.room_number}/${bed.bed_label}${Number(bed.floor) === 0 ? ' (ground)' : ''}`)
        .join(', ');
      print(`      ${color.dim('best free beds:')} ${best}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Allocations & stays                                                 */
/* ------------------------------------------------------------------ */

export function printAllocation(allocation) {
  print(
    keyValue([
      ['Allocation #', String(allocation.id)],
      ['Student', `${allocation.student_code} - ${allocation.student_name ?? ''}`.trim()],
      ['Hostel', allocation.hostel_name],
      ['Room / Bed', `${allocation.room_number} / ${allocation.bed_label}`],
      ['Status', allocation.status],
      ['Assigned', dateTime(allocation.assigned_at)],
      ['Checked in', dateTime(allocation.checked_in_at)],
      ['Checked out', dateTime(allocation.checked_out_at)],
    ]),
  );
  if (allocation.notes) print(color.dim(`  Notes: ${allocation.notes}`));
}

export function printAllocations(rows) {
  print(
    table(
      rows.map((row) => ({
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
        { key: 'id', header: 'ID', align: 'right' },
        { key: 'student_code', header: 'Student ID' },
        { key: 'student_name', header: 'Name' },
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'status', header: 'Status', format: (row) => row.status },
        { key: 'assigned_at', header: 'Assigned', format: (row) => dateTime(row.assigned_at) },
        { key: 'checked_in_at', header: 'Checked in', format: (row) => dateTime(row.checked_in_at) },
      ],
    ),
  );
}

export function printResidents(rows) {
  print(
    table(
      rows.map((row) => ({
        ...row,
        status: row.status === 'checked_in' ? color.green('in') : color.yellow('assigned'),
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
        { key: 'since', header: 'Since', format: (row) => dateTime(row.since) },
      ],
    ),
  );
}

export function printStayLogs(rows) {
  print(
    table(
      rows.map((row) => ({
        ...row,
        action: row.action === 'checked_in'
          ? color.green('checked in')
          : row.action === 'checked_out'
            ? color.yellow('checked out')
            : color.dim('cancelled'),
      })),
      [
        { key: 'id', header: 'ID', align: 'right' },
        { key: 'at', header: 'When', format: (row) => dateTime(row.at) },
        { key: 'action', header: 'Action', format: (row) => row.action },
        { key: 'student_code', header: 'Student ID' },
        { key: 'student_name', header: 'Name' },
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'actor', header: 'By' },
      ],
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export function printAvailability(rows) {
  print(
    table(
      rows.map((row) => ({
        ...row,
        rule: hostelRuleText(row.hostel),
        bar: renderBar(Number(row.occupied_beds), Number(row.total_beds)),
      })),
      [
        { key: 'hostel', header: 'Hostel', format: (row) => row.hostel.name },
        { key: 'rule', header: 'Rule', format: (row) => row.rule },
        { key: 'total_rooms', header: 'Rooms', align: 'right' },
        { key: 'total_beds', header: 'Beds', align: 'right' },
        { key: 'checked_in_beds', header: 'In', align: 'right' },
        { key: 'reserved_beds', header: 'Reserved', align: 'right' },
        { key: 'free_beds', header: 'Free', align: 'right' },
        { key: 'utilisation', header: 'Use %', align: 'right' },
        { key: 'bar', header: 'Occupancy', format: (row) => row.bar },
      ],
    ),
  );
  const totals = rows.reduce(
    (acc, row) => ({
      beds: acc.beds + Number(row.total_beds),
      free: acc.free + Number(row.free_beds),
      occupied: acc.occupied + Number(row.occupied_beds),
    }),
    { beds: 0, free: 0, occupied: 0 },
  );
  print(
    color.dim(
      `\n  TOTAL: ${totals.beds} bed(s), ${totals.occupied} occupied, ${totals.free} free across ${rows.length} hostel(s).`,
    ),
  );
}

export function printRoomAvailability(rows) {
  print(
    table(rows, [
      { key: 'hostel_name', header: 'Hostel' },
      { key: 'room_number', header: 'Room' },
      { key: 'floor', header: 'Floor', align: 'right', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
      { key: 'total_beds', header: 'Beds', align: 'right' },
      { key: 'occupied_beds', header: 'Occupied', align: 'right' },
      { key: 'free_beds', header: 'Free', align: 'right' },
      { key: 'amenities', header: 'Amenities', format: (row) => row.amenities || color.dim('-') },
    ]),
  );
}

export function printStudentsByRoom(rows) {
  print(
    table(rows, [
      { key: 'hostel_name', header: 'Hostel' },
      { key: 'room_number', header: 'Room' },
      { key: 'bed_label', header: 'Bed' },
      { key: 'bunk_level', header: 'Bunk' },
      { key: 'student_code', header: 'Student ID' },
      { key: 'student_name', header: 'Name' },
      { key: 'student_gender', header: 'Gender' },
      { key: 'student_year_form', header: 'Year/Form' },
      {
        key: 'allocation_status',
        header: 'Status',
        format: (row) => (row.allocation_status === 'checked_in' ? color.green('checked in') : color.yellow('assigned')),
      },
    ]),
  );
}

export function printOccupancyByHostel(rows) {
  print(
    table(rows, [
      { key: 'hostel_name', header: 'Hostel' },
      { key: 'gender', header: 'Gender' },
      { key: 'category', header: 'Year/Form' },
      { key: 'total_beds', header: 'Beds', align: 'right' },
      { key: 'checked_in_beds', header: 'Checked in', align: 'right' },
      { key: 'reserved_beds', header: 'Reserved', align: 'right' },
      { key: 'occupied_beds', header: 'Occupied', align: 'right' },
      { key: 'free_beds', header: 'Free', align: 'right' },
      { key: 'utilisation', header: 'Use %', align: 'right' },
    ]),
  );
}

export function printDashboard(data) {
  print(color.bold('\n  Hostel system at a glance'));
  print(
    keyValue([
      ['Hostels', `${data.hostels} (${data.rooms} rooms, ${data.beds} beds)`],
      ['Active students', String(data.students)],
      ['Checked in', color.green(String(data.checked_in))],
      ['Assigned (awaiting check-in)', color.yellow(String(data.assigned))],
      ['Free beds', String(data.freeBeds)],
      ['Occupancy', `${data.utilisation}%`],
      ['Fees collected', money(data.fees_collected, data.currency)],
      ['First deposit policy', money(data.firstDepositRequirement, data.currency)],
      ['Active users', String(data.users)],
    ]),
  );
}

export function printUnallocated(rows, currency) {
  print(
    table(
      rows.map((row) => ({
        ...row,
        fee: row.feeOk ? color.green('eligible') : color.red('no deposit'),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'gender', header: 'Gender' },
        { key: 'year_form', header: 'Year/Form' },
        { key: 'total_paid', header: 'Paid', align: 'right', format: (row) => money(row.total_paid, currency) },
        { key: 'fee', header: 'Fee status', format: (row) => row.fee },
      ],
    ),
  );
}

export function printInventoryCheck(rows) {
  print(
    table(
      rows.map((row) => ({ ...row, state: row.consistent ? color.green('consistent') : color.red('MISMATCH') })),
      [
        { key: 'name', header: 'Hostel' },
        { key: 'declared_rooms', header: 'Declared rooms', align: 'right' },
        { key: 'actual_rooms', header: 'Actual rooms', align: 'right' },
        { key: 'declared_beds', header: 'Declared beds', align: 'right' },
        { key: 'actual_beds', header: 'Actual beds', align: 'right' },
        { key: 'state', header: 'State', format: (row) => row.state },
      ],
    ),
  );
}

export function printSpecialNeedsOverview(overview) {
  const { withConditions, notesOnly } = overview;
  print(section('Structured requirements (codes only - no medical text)'));
  print(
    table(
      withConditions.map((row) => ({
        ...row,
        level: row.level === 'required' ? color.red('required') : color.yellow('preferred'),
        placement: row.hostel_name
          ? `${row.hostel_name} ${row.room_number}/${row.bed_label} (${row.allocation_status})`
          : color.dim('unallocated'),
        privateNotes: row.has_private_notes ? color.yellow('Yes') : color.dim('No'),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'code', header: 'Requirement' },
        { key: 'level', header: 'Level', format: (row) => row.level },
        { key: 'placement', header: 'Placement', format: (row) => row.placement },
        { key: 'privateNotes', header: 'Private notes', format: (row) => row.privateNotes },
      ],
      { empty: 'No structured requirements recorded.' },
    ),
  );

  print(section('Private notes only (no structured code)'));
  print(
    table(
      notesOnly.map((row) => ({
        ...row,
        placement: row.hostel_name
          ? `${row.hostel_name} ${row.room_number}/${row.bed_label}`
          : color.dim('unallocated'),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'placement', header: 'Placement', format: (row) => row.placement },
      ],
      { empty: 'None.' },
    ),
  );
}

export function printAuditLog(rows) {
  print(
    table(rows, [
      { key: 'id', header: 'ID', align: 'right' },
      { key: 'at', header: 'When', format: (row) => dateTime(row.at) },
      { key: 'username', header: 'User', format: (row) => row.username ?? color.dim('system') },
      { key: 'action', header: 'Action' },
      { key: 'entity', header: 'Entity', format: (row) => row.entity ?? color.dim('-') },
      { key: 'entity_id', header: 'Ref', align: 'right', format: (row) => row.entity_id ?? color.dim('-') },
      { key: 'detail', header: 'Detail', format: (row) => row.detail ?? color.dim('-') },
    ]),
  );
}

export function printUsers(rows) {
  print(
    table(
      rows.map((row) => ({
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
}

export function printSettings(rows) {
  print(
    table(rows, [
      { key: 'key', header: 'Key' },
      { key: 'value', header: 'Value' },
      { key: 'label', header: 'Description', format: (row) => row.label ?? color.dim('-') },
      { key: 'updated_at', header: 'Updated', format: (row) => dateTime(row.updated_at) },
    ]),
  );
}

export function printHostelDetail({ hostel, rooms, beds }) {
  print(
    keyValue([
      ['Hostel', `${hostel.name} (ID ${hostel.id})`],
      ['Rule', hostelRuleText(hostel)],
      ['Rooms', `${rooms.length} (declared ${hostel.total_rooms})`],
      ['Beds', `${beds.length} (declared ${hostel.total_beds})`],
      ['Description', hostel.description ?? color.dim('-')],
      ['Created', dateTime(hostel.created_at)],
    ]),
  );
}

function renderBar(occupied, total, width = 12) {
  if (!total) return color.dim('-');
  const filled = Math.round((occupied / total) * width);
  const bar = `${'#'.repeat(filled)}${'.'.repeat(Math.max(0, width - filled))}`;
  const ratio = occupied / total;
  const painted = ratio >= 0.9 ? color.red(bar) : ratio >= 0.6 ? color.yellow(bar) : color.green(bar);
  return `${painted} ${Math.round(ratio * 100)}%`;
}

export { describeCategory };
