import { PERMISSIONS } from '../../security/permissions.js';
import * as reportService from '../../services/reportService.js';
import * as stayService from '../../services/stayService.js';
import * as auditService from '../../services/auditService.js';
import { getCurrency } from '../../services/settingsService.js';
import { color, dateTime, money, print, table } from '../ui.js';
import { integer, select } from '../prompts.js';
import { runMenu, pickHostel } from './common.js';

export async function reportMenu(actor) {
  await runMenu({
    title: 'Availability & reports',
    actor,
    options: [
      {
        label: 'Dashboard summary',
        value: 'dashboard',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => {
          const data = reportService.dashboard();
          print(color.bold(`\n  ${data.institution}`));
          print(
            table(
              [
                { metric: 'Hostels', value: String(data.hostels) },
                { metric: 'Rooms', value: String(data.rooms) },
                { metric: 'Beds', value: String(data.beds) },
                { metric: 'Students (active)', value: String(data.students) },
                { metric: 'Checked in', value: String(data.checked_in) },
                { metric: 'Assigned (awaiting check-in)', value: String(data.assigned) },
                { metric: 'Free beds', value: String(data.freeBeds) },
                { metric: 'Occupancy', value: `${data.utilisation}%` },
                { metric: 'Fees collected', value: money(data.fees_collected, data.currency) },
                { metric: 'First deposit policy', value: money(data.firstDepositRequirement, data.currency) },
              ],
              [
                { key: 'metric', header: 'Metric' },
                { key: 'value', header: 'Value', align: 'right' },
              ],
            ),
          );
        },
      },
      {
        label: 'Bed availability per hostel (real time)',
        value: 'availability',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => availabilityFlow(),
      },
      {
        label: 'Free beds list (with physical details)',
        value: 'freebeds',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => freeBedsFlow(),
      },
      {
        label: 'Room availability',
        value: 'rooms',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => roomAvailabilityFlow(),
      },
      {
        label: 'Which student is in which room',
        value: 'byroom',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => studentsByRoomFlow(),
      },
      {
        label: 'Occupancy counts per hostel',
        value: 'occupancy',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => occupancyFlow(),
      },
      {
        label: 'Current residents list',
        value: 'residents',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => residentsFlow(),
      },
      {
        label: 'Unallocated students (registered, no bed)',
        value: 'unallocated',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => unallocatedFlow(),
      },
      {
        label: 'Fee status & eligibility list',
        value: 'fees',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => feeFlow(),
      },
      {
        label: 'Special needs accommodation overview (privacy-safe)',
        value: 'needs',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => needsFlow(),
      },
      {
        label: 'Inventory consistency check',
        value: 'inventory',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => {
          const rows = reportService.inventoryReport();
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
        },
      },
      {
        label: 'Audit trail (who did what)',
        value: 'audit',
        permission: PERMISSIONS.AUDIT_VIEW,
        run: () => auditFlow(),
      },
    ],
  });
}

async function availabilityFlow() {
  const scope = await select('Scope', [
    { name: 'All hostels', value: 'all' },
    { name: 'One hostel', value: 'one' },
  ]);
  const rows = reportService.availability(
    scope === 'one' ? { hostelIdentifier: (await pickHostel())?.id } : {},
  );
  printAvailabilityRows(rows);
}

function printAvailabilityRows(rows) {
  print(
    table(
      rows.map((row) => ({
        name: row.hostel.name,
        rule: `${row.hostel.gender}${row.hostel.category === 'ALL' ? '' : ` / ${row.hostel.category}`}`,
        rooms: row.total_rooms,
        beds: row.total_beds,
        in: row.checked_in_beds,
        reserved: row.reserved_beds,
        free: row.free_beds,
        use: `${row.utilisation}%`,
      })),
      [
        { key: 'name', header: 'Hostel' },
        { key: 'rule', header: 'Rule' },
        { key: 'rooms', header: 'Rooms', align: 'right' },
        { key: 'beds', header: 'Beds', align: 'right' },
        { key: 'in', header: 'Checked in', align: 'right' },
        { key: 'reserved', header: 'Reserved', align: 'right' },
        { key: 'free', header: 'Free', align: 'right' },
        { key: 'use', header: 'Use %', align: 'right' },
      ],
      { empty: 'No hostels registered.' },
    ),
  );
  const totals = rows.reduce(
    (acc, row) => ({ beds: acc.beds + Number(row.total_beds), free: acc.free + Number(row.free_beds) }),
    { beds: 0, free: 0 },
  );
  print(color.dim(`\n  Total: ${totals.beds} bed(s), ${totals.free} free.`));
}

async function freeBedsFlow() {
  const scope = await select('Scope', [
    { name: 'All hostels', value: 'all' },
    { name: 'One hostel', value: 'one' },
  ]);
  const hostel = scope === 'one' ? await pickHostel() : null;
  if (scope === 'one' && !hostel) return;

  const rows = reportService.freeBedList({ hostelIdentifier: hostel?.id ?? null });
  print(
    table(rows, [
      { key: 'bed_id', header: 'Bed ID', align: 'right' },
      { key: 'hostel_name', header: 'Hostel' },
      { key: 'room_number', header: 'Room' },
      { key: 'bed_label', header: 'Bed' },
      { key: 'bunk_level', header: 'Bunk' },
      { key: 'floor', header: 'Floor', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
      { key: 'amenities', header: 'Amenities', format: (row) => row.amenities || color.dim('-') },
    ],
    { empty: 'No free beds.' }),
  );
}

async function roomAvailabilityFlow() {
  const scope = await select('Scope', [
    { name: 'All hostels', value: 'all' },
    { name: 'One hostel', value: 'one' },
  ]);
  const hostel = scope === 'one' ? await pickHostel() : null;
  if (scope === 'one' && !hostel) return;

  const onlyFree = await select('Show', [
    { name: 'Every room', value: false },
    { name: 'Only rooms with free beds', value: true },
  ]);

  const rows = reportService.roomAvailability({
    hostelIdentifier: hostel?.id ?? null,
    onlyFree,
  });
  print(
    table(rows, [
      { key: 'hostel_name', header: 'Hostel' },
      { key: 'room_number', header: 'Room' },
      { key: 'floor', header: 'Floor', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
      { key: 'total_beds', header: 'Beds', align: 'right' },
      { key: 'occupied_beds', header: 'Occupied', align: 'right' },
      { key: 'free_beds', header: 'Free', align: 'right' },
      { key: 'amenities', header: 'Amenities', format: (row) => row.amenities || color.dim('-') },
      {
        key: 'room_enabled',
        header: 'State',
        format: (row) => (row.room_enabled === 1 ? color.green('open') : color.yellow('closed')),
      },
    ],
    { empty: 'No rooms matched.' }),
  );
}

async function studentsByRoomFlow() {
  const scope = await select('Scope', [
    { name: 'All hostels', value: 'all' },
    { name: 'One hostel', value: 'one' },
  ]);
  const hostel = scope === 'one' ? await pickHostel() : null;
  if (scope === 'one' && !hostel) return;

  const rows = reportService.studentsByRoom({ hostelIdentifier: hostel?.id ?? null });
  print(
    table(
      rows.map((row) => ({
        ...row,
        status: row.allocation_status === 'checked_in' ? color.green('checked in') : color.yellow('assigned'),
      })),
      [
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'bunk_level', header: 'Bunk' },
        { key: 'student_code', header: 'Student ID' },
        { key: 'student_name', header: 'Name' },
        { key: 'student_gender', header: 'Gender' },
        { key: 'student_year_form', header: 'Year/Form' },
        { key: 'status', header: 'Status', format: (row) => row.status },
      ],
      { empty: 'No beds are occupied.' },
    ),
  );
}

async function occupancyFlow() {
  const rows = reportService.occupancyByHostel();
  print(
    table(rows, [
      { key: 'hostel_name', header: 'Hostel' },
      { key: 'gender', header: 'Gender' },
      { key: 'category', header: 'Year/Form', format: (row) => (row.category === 'ALL' ? 'All' : row.category) },
      { key: 'total_rooms', header: 'Rooms', align: 'right' },
      { key: 'total_beds', header: 'Beds', align: 'right' },
      { key: 'checked_in_beds', header: 'Checked in', align: 'right' },
      { key: 'reserved_beds', header: 'Reserved', align: 'right' },
      { key: 'free_beds', header: 'Free', align: 'right' },
      { key: 'utilisation', header: 'Use %', align: 'right' },
    ],
    { empty: 'No hostels registered.' }),
  );
}

async function residentsFlow() {
  const rows = stayService.currentResidents({});
  print(
    table(rows, [
      { key: 'student_code', header: 'Student ID' },
      { key: 'student_name', header: 'Name' },
      { key: 'gender', header: 'Gender' },
      { key: 'year_form', header: 'Year/Form' },
      { key: 'hostel_name', header: 'Hostel' },
      { key: 'room_number', header: 'Room' },
      { key: 'bed_label', header: 'Bed' },
      { key: 'checked_in_at', header: 'Checked in', format: (row) => dateTime(row.checked_in_at) },
    ],
    { empty: 'Nobody is checked in.' }),
  );
}

async function unallocatedFlow() {
  const currency = getCurrency();
  const rows = reportService.unallocatedStudents();
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
      { empty: 'Every active student has a bed.' }),
  );
}

async function feeFlow() {
  const mode = await select('View', [
    { name: 'All students', value: 'all' },
    { name: 'Only students short of the first deposit', value: 'short' },
  ]);
  const currency = getCurrency();
  const rows = reportService.feeReport({ onlyShortfall: mode === 'short' });
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
        { key: 'required', header: 'Required', align: 'right', format: (row) => money(row.required, currency) },
        { key: 'status', header: 'Status', format: (row) => row.status },
      ],
      { empty: 'No matching students.' }),
  );
}

async function needsFlow() {
  const scope = await select('Scope', [
    { name: 'All hostels', value: 'all' },
    { name: 'One hostel', value: 'one' },
  ]);
  const hostel = scope === 'one' ? await pickHostel() : null;
  if (scope === 'one' && !hostel) return;

  const overview = reportService.specialNeedsOverview({ hostelIdentifier: hostel?.id ?? null });
  print(
    color.dim(
      '\n  This report never prints medical text. Private notes are flagged, not shown.',
    ),
  );

  print(color.bold('\n  Structured requirements (matchable)'));
  print(
    table(
      overview.withConditions.map((row) => ({
        ...row,
        level: row.level === 'required' ? color.red('required') : color.yellow('preferred'),
        placement: row.hostel_name
          ? `${row.hostel_name} ${row.room_number}/${row.bed_label} (${row.allocation_status})`
          : color.dim('unallocated'),
        privateNotes: row.has_private_notes ? color.yellow('yes') : color.dim('no'),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'code', header: 'Requirement' },
        { key: 'level', header: 'Level', format: (row) => row.level },
        { key: 'placement', header: 'Placement', format: (row) => row.placement },
        { key: 'privateNotes', header: 'Private notes', format: (row) => row.privateNotes },
      ],
      { empty: 'No structured requirements recorded.' }),
  );

  print(color.bold('\n  Students with private notes only (no matchable code)'));
  print(
    table(
      overview.notesOnly.map((row) => ({
        ...row,
        placement: row.hostel_name
          ? `${row.hostel_name} ${row.room_number}/${row.bed_label} (${row.allocation_status})`
          : color.dim('unallocated'),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'gender', header: 'Gender' },
        { key: 'year_form', header: 'Year/Form' },
        { key: 'placement', header: 'Placement', format: (row) => row.placement },
      ],
      { empty: 'None.' }),
  );
  print(
    color.dim(
      '\n  Reminder: private notes are only revealed through the student profile, with permission and an audit entry.',
    ),
  );
}

async function auditFlow() {
  const limit = await integer('How many recent entries?', { field: 'Limit', min: 1, max: 500, default: 40 });
  const actionFilter = await select('Filter', [
    { name: 'Everything', value: null },
    { name: 'Privacy reveals only', value: 'privacy.health_notes_revealed' },
    { name: 'Authentication only', value: 'auth.login' },
    { name: 'Failed logins only', value: 'auth.failed' },
    { name: 'Allocation events', value: 'allocation.assigned' },
  ]);
  const rows = auditService.listAuditLog({ limit, action: actionFilter });
  print(
    table(
      rows.map((row) => ({ ...row, username: row.username ?? color.dim('system') })),
      [
        { key: 'id', header: 'ID', align: 'right' },
        { key: 'at', header: 'When' },
        { key: 'username', header: 'User', format: (row) => row.username },
        { key: 'action', header: 'Action' },
        { key: 'entity', header: 'Entity', format: (row) => row.entity ?? color.dim('-') },
        { key: 'detail', header: 'Detail', format: (row) => row.detail ?? color.dim('-') },
      ],
      { empty: 'No audit entries for this filter.' }),
  );
}
