import { Command } from 'commander';
import { APP_NAME, APP_VERSION, GENDERS, YEAR_FORMS, HOSTEL_GENDERS, ROOM_AMENITIES, BUNK_LEVELS, ALL_YEARS, HEALTH_REQUIREMENT_CODES, DEFAULT_ADMIN } from '../config.js';
import { ensureDatabase, databaseExists, closeDatabase } from '../db/connection.js';
import { initialise, ensureAdministrator } from '../db/bootstrap.js';
import * as authService from '../services/authService.js';
import * as hostelService from '../services/hostelService.js';
import * as studentService from '../services/studentService.js';
import * as feeService from '../services/feeService.js';
import * as eligibilityService from '../services/eligibilityService.js';
import * as allocationService from '../services/allocationService.js';
import * as stayService from '../services/stayService.js';
import * as reportService from '../services/reportService.js';
import * as settingsService from '../services/settingsService.js';
import * as auditService from '../services/auditService.js';
import { requirementLabel } from '../services/matching.js';
import { PERMISSIONS, can, ROLE_NAMES, describePermissions } from '../security/permissions.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { color, dateTime, keyValue, money, print, printError, success, table, warn, heading } from './ui.js';
import { runInteractive, quickSetup } from './index.js';
import { password as promptPassword, confirm } from './prompts.js';

const AUTH_OPTIONS = (command) =>
  command
    .option('-u, --user <username>', 'system user (default: $HOSTEL_USER or the administrator account)')
    .option('-p, --password <password>', 'password (default: $HOSTEL_PASSWORD, otherwise prompted)');

async function resolveActor(options) {
  const username = options.user ?? process.env.HOSTEL_USER ?? DEFAULT_ADMIN.username;
  let secret = options.password ?? process.env.HOSTEL_PASSWORD;

  if (!secret) {
    if (!process.stdin.isTTY) {
      throw new AppError(
        'Authentication required. Pass --password (or --user/--password) or set HOSTEL_PASSWORD.',
      );
    }
    secret = await promptPassword(`Password for ${username}`);
  }

  const user = authService.authenticate(username, secret);
  if (!user) throw new AppError('Authentication failed: wrong username or password.');
  return user;
}

const asActor = (...callArgs) => {
  const handler = callArgs[callArgs.length - 1];
  return async function authenticatedAction() {
    const command = this;
    const options = typeof command?.opts === 'function' ? command.opts() : {};
    const actor = await resolveActor(options);
    return handler(actor);
  };
};

const parseAmenities = (value) => value ?? '';

export function buildProgram() {
  const program = new Command();

  program
    .name('hostel')
    .description(`${APP_NAME} - command line bed allocation for hostels`)
    .version(APP_VERSION, '-v, --version')
    .showHelpAfterError('(add --help for additional information)');

  program
    .command('init')
    .description('create the database, schema and administrator account')
    .option('-f, --force', 'delete the existing database file first (resets all data)')
    .option('--admin-user <username>', 'administrator username (default: the configured administrator)')
    .option('--admin-password <password>', 'administrator password (default: the configured administrator)')
    .option('--admin-name <name>', 'administrator full name')
    .action((options) => {
      const existed = databaseExists();
      initialise({ force: Boolean(options.force) });
      print(success(`Database ready (${existed && !options.force ? 'existing' : 'created'}).`));

      const result = ensureAdministrator({
        username: options.adminUser,
        password: options.adminPassword,
        fullName: options.adminName,
      });

      if (result.created) {
        print(success(`Administrator "${result.user.username}" created.`));
      } else {
        print(color.dim('  An administrator account already exists; nothing to create.'));
      }
      print(color.dim('  Next: "node bin/hostel.js menu" to sign in.'));
    });

  program
    .command('menu', { isDefault: true })
    .description('start the interactive menu (default)')
    .action(async () => {
      ensureDatabase();
      process.exitCode = await runInteractive();
    });

  program
    .command('dashboard')
    .description('high level counters')
    .action(() => {
      ensureDatabase();
      const data = reportService.dashboard();
      print(
        keyValue([
          ['Institution', data.institution],
          ['Hostels', String(data.hostels)],
          ['Rooms', String(data.rooms)],
          ['Beds', String(data.beds)],
          ['Active students', String(data.students)],
          ['Checked in', String(data.checked_in)],
          ['Assigned', String(data.assigned)],
          ['Free beds', String(data.freeBeds)],
          ['Occupancy', `${data.utilisation}%`],
          ['Fees collected', money(data.fees_collected, data.currency)],
        ]),
      );
    });

  program
    .command('availability')
    .description('real-time bed availability')
    .option('-H, --hostel <hostel>', 'limit to one hostel (name or id)')
    .action((options) => {
      ensureDatabase();
      const rows = reportService.availability({ hostelIdentifier: options.hostel ?? null });
      print(
        table(
          rows.map((row) => ({
            hostel: row.hostel.name,
            rule: hostelService.hostelRuleText(row.hostel),
            rooms: row.total_rooms,
            beds: row.total_beds,
            checkedIn: row.checked_in_beds,
            reserved: row.reserved_beds,
            free: row.free_beds,
            use: `${row.utilisation}%`,
          })),
          [
            { key: 'hostel', header: 'Hostel' },
            { key: 'rule', header: 'Rule' },
            { key: 'rooms', header: 'Rooms', align: 'right' },
            { key: 'beds', header: 'Beds', align: 'right' },
            { key: 'checkedIn', header: 'Checked in', align: 'right' },
            { key: 'reserved', header: 'Reserved', align: 'right' },
            { key: 'free', header: 'Free', align: 'right' },
            { key: 'use', header: 'Use %', align: 'right' },
          ],
          { empty: 'No hostels registered.' },
        ),
      );
    });

  program
    .command('rooms')
    .description('room availability')
    .option('-H, --hostel <hostel>', 'limit to one hostel')
    .option('--only-free', 'only rooms with at least one free bed')
    .action((options) => {
      ensureDatabase();
      const rows = reportService.roomAvailability({
        hostelIdentifier: options.hostel ?? null,
        onlyFree: Boolean(options.onlyFree),
      });
      print(
        table(rows, [
          { key: 'hostel_name', header: 'Hostel' },
          { key: 'room_number', header: 'Room' },
          { key: 'floor', header: 'Floor', align: 'right' },
          { key: 'total_beds', header: 'Beds', align: 'right' },
          { key: 'occupied_beds', header: 'Occupied', align: 'right' },
          { key: 'free_beds', header: 'Free', align: 'right' },
          { key: 'amenities', header: 'Amenities' },
        ], { empty: 'No rooms found.' }),
      );
    });

  program
    .command('free-beds')
    .description('list every free bed with its physical attributes')
    .option('-H, --hostel <hostel>', 'limit to one hostel')
    .action((options) => {
      ensureDatabase();
      const rows = reportService.freeBedList({ hostelIdentifier: options.hostel ?? null });
      print(
        table(rows, [
          { key: 'bed_id', header: 'Bed ID', align: 'right' },
          { key: 'hostel_name', header: 'Hostel' },
          { key: 'room_number', header: 'Room' },
          { key: 'bed_label', header: 'Bed' },
          { key: 'bunk_level', header: 'Bunk' },
          { key: 'floor', header: 'Floor', align: 'right' },
          { key: 'amenities', header: 'Amenities' },
        ], { empty: 'No free beds.' }),
      );
    });

  program
    .command('occupancy')
    .description('occupancy counts per hostel')
    .action(() => {
      ensureDatabase();
      print(
        table(reportService.occupancyByHostel(), [
          { key: 'hostel_name', header: 'Hostel' },
          { key: 'gender', header: 'Gender' },
          { key: 'category', header: 'Year/Form' },
          { key: 'total_beds', header: 'Beds', align: 'right' },
          { key: 'checked_in_beds', header: 'Checked in', align: 'right' },
          { key: 'reserved_beds', header: 'Reserved', align: 'right' },
          { key: 'free_beds', header: 'Free', align: 'right' },
          { key: 'utilisation', header: 'Use %', align: 'right' },
        ], { empty: 'No hostels registered.' }),
      );
    });

  program
    .command('residents')
    .description('current residents (checked in)')
    .option('-H, --hostel <hostel>', 'limit to one hostel')
    .option('--assigned', 'include students assigned but not yet checked in')
    .action((options) => {
      ensureDatabase();
      const hostel = options.hostel ? hostelService.getHostel(options.hostel) : null;
      const rows = stayService.currentResidents({ hostelId: hostel?.id ?? null, assignedOnly: Boolean(options.assigned) });
      print(
        table(rows, [
          { key: 'student_code', header: 'Student ID' },
          { key: 'student_name', header: 'Name' },
          { key: 'gender', header: 'Gender' },
          { key: 'year_form', header: 'Year/Form' },
          { key: 'hostel_name', header: 'Hostel' },
          { key: 'room_number', header: 'Room' },
          { key: 'bed_label', header: 'Bed' },
          { key: 'status', header: 'Status' },
          { key: 'checked_in_at', header: 'Checked in' },
        ], { empty: 'Nobody is checked in.' }),
      );
    });

  program
    .command('who-is-where')
    .description('documentational query: which student occupies which room/bed')
    .option('-H, --hostel <hostel>', 'limit to one hostel')
    .action((options) => {
      ensureDatabase();
      const rows = reportService.studentsByRoom({ hostelIdentifier: options.hostel ?? null });
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
          { key: 'allocation_status', header: 'Status' },
        ], { empty: 'No beds occupied.' }),
      );
    });

  program
    .command('unallocated')
    .description('students with no active bed')
    .action(() => {
      ensureDatabase();
      const currency = settingsService.getCurrency();
      print(
        table(
          reportService.unallocatedStudents().map((row) => ({
            ...row,
            fee: row.feeOk ? 'eligible' : 'needs deposit',
          })),
          [
            { key: 'student_code', header: 'Student ID' },
            { key: 'full_name', header: 'Name' },
            { key: 'gender', header: 'Gender' },
            { key: 'year_form', header: 'Year/Form' },
            { key: 'total_paid', header: `Paid (${currency})`, align: 'right' },
            { key: 'fee', header: 'Fee status' },
          ],
          { empty: 'Every active student has a bed.' },
        ),
      );
    });

  program
    .command('needs')
    .description('special-needs accommodation overview (never prints medical text)')
    .option('-H, --hostel <hostel>', 'limit to one hostel')
    .action((options) => {
      ensureDatabase();
      const overview = reportService.specialNeedsOverview({ hostelIdentifier: options.hostel ?? null });
      print(
        table(
          overview.withConditions.map((row) => ({
            ...row,
            meaning: requirementLabel(row.code),
            placement: row.hostel_name ? `${row.hostel_name} ${row.room_number}/${row.bed_label}` : 'unallocated',
            privateNotes: row.has_private_notes ? 'yes' : 'no',
          })),
          [
            { key: 'student_code', header: 'Student ID' },
            { key: 'full_name', header: 'Name' },
            { key: 'code', header: 'Requirement' },
            { key: 'meaning', header: 'Meaning' },
            { key: 'level', header: 'Level' },
            { key: 'placement', header: 'Placement' },
            { key: 'privateNotes', header: 'Private notes' },
          ],
          { empty: 'No structured requirements recorded.' },
        ),
      );
      print(
        color.dim(
          `\n  ${overview.notesOnly.length} other student(s) hold private notes without a matchable code; text is never shown here.`,
        ),
      );
    });

  program
    .command('inventory-check')
    .description('verify declared vs actual rooms/beds per hostel')
    .action(() => {
      ensureDatabase();
      print(
        table(
          reportService.inventoryReport().map((row) => ({
            ...row,
            state: row.consistent ? 'consistent' : 'MISMATCH',
          })),
          [
            { key: 'name', header: 'Hostel' },
            { key: 'declared_rooms', header: 'Declared rooms', align: 'right' },
            { key: 'actual_rooms', header: 'Actual rooms', align: 'right' },
            { key: 'declared_beds', header: 'Declared beds', align: 'right' },
            { key: 'actual_beds', header: 'Actual beds', align: 'right' },
            { key: 'state', header: 'State' },
          ],
          { empty: 'No hostels registered.' },
        ),
      );
    });

  program
    .command('audit')
    .description('audit trail (authentication, changes, privacy reveals)')
    .option('-n, --limit <number>', 'number of rows', '30')
    .option('-a, --action <action>', 'filter by exact action')
    .action((options) => {
      ensureDatabase();
      const rows = auditService.listAuditLog({
        limit: Number(options.limit),
        action: options.action ?? null,
      });
      print(
        table(
          rows.map((row) => ({ ...row, when: dateTime(row.at), detail: row.detail ?? '' })),
          [
            { key: 'id', header: 'ID', align: 'right' },
            { key: 'when', header: 'When' },
            { key: 'username', header: 'User' },
            { key: 'action', header: 'Action' },
            { key: 'entity', header: 'Entity' },
            { key: 'detail', header: 'Detail' },
          ],
          { empty: 'No audit entries.' },
        ),
      );
    });

  const hostels = program.command('hostels').description('hostel inventory operations');

  hostels
    .command('list')
    .description('list hostels with occupancy')
    .action(() => {
      ensureDatabase();
      print(
        table(
          hostelService.listHostels().map((row) => ({
            ...row,
            rule: hostelService.hostelRuleText(row),
          })),
          [
            { key: 'id', header: 'ID', align: 'right' },
            { key: 'name', header: 'Hostel' },
            { key: 'rule', header: 'Rule' },
            { key: 'actual_rooms', header: 'Rooms', align: 'right' },
            { key: 'actual_beds', header: 'Beds', align: 'right' },
            { key: 'occupied_beds', header: 'Occupied', align: 'right' },
            { key: 'free_beds', header: 'Free', align: 'right' },
          ],
          { empty: 'No hostels registered.' },
        ),
      );
    });

  AUTH_OPTIONS(
    hostels
      .command('add')
      .description('register a hostel and generate its rooms/beds')
      .requiredOption('--name <name>')
      .requiredOption('--gender <gender>', `one of: ${HOSTEL_GENDERS.join(', ')}`)
      .requiredOption('--rooms <number>')
      .requiredOption('--beds <number>')
      .option('--category <category>', `year/form restriction (${ALL_YEARS} = all)`, ALL_YEARS)
      .option('--rooms-per-floor <number>', 'rooms per floor (floor 0 = ground floor)')
      .option('--description <text>'),
  ).action(
    asActor(async (actor) => {
      const options = hostels.commands.find((c) => c.name() === 'add').opts();
      const hostel = hostelService.createHostel(
        {
          name: options.name,
          gender: options.gender,
          category: options.category,
          totalRooms: options.rooms,
          totalBeds: options.beds,
          roomsPerFloor: options.roomsPerFloor,
          description: options.description,
        },
        actor,
      );
      print(success(`Hostel "${hostel.name}" created: ${hostel.total_rooms} rooms / ${hostel.total_beds} beds.`));
    }),
  );

  hostels
    .command('show <hostel>')
    .description('show rooms and beds of a hostel')
    .action((hostelIdentifier) => {
      ensureDatabase();
      const hostel = hostelService.getHostel(hostelIdentifier);
      const rooms = hostelService.listRooms(hostel.id);
      const beds = hostelService.listBeds(hostel.id);
      print(
        keyValue([
          ['Hostel', `${hostel.name} (ID ${hostel.id})`],
          ['Rule', hostelService.hostelRuleText(hostel)],
          ['Rooms', String(rooms.length)],
          ['Beds', String(beds.length)],
        ]),
      );
      print(
        table(rooms, [
          { key: 'id', header: 'Room ID', align: 'right' },
          { key: 'room_number', header: 'Room' },
          { key: 'floor', header: 'Floor', align: 'right' },
          { key: 'capacity', header: 'Capacity', align: 'right' },
          { key: 'occupied_beds', header: 'Occupied', align: 'right' },
          { key: 'amenities', header: 'Amenities' },
        ], { empty: 'No rooms.' }),
      );
      print(
        table(
          beds.map((bed) => ({
            ...bed,
            state: bed.is_occupied ? `occupied by ${bed.student_code}` : bed.bed_enabled === 1 ? 'free' : 'disabled',
          })),
          [
            { key: 'bed_id', header: 'Bed ID', align: 'right' },
            { key: 'room_number', header: 'Room' },
            { key: 'bed_label', header: 'Bed' },
            { key: 'bunk_level', header: 'Bunk' },
            { key: 'state', header: 'Status' },
          ],
          { empty: 'No beds.' },
        ),
      );
    });

  AUTH_OPTIONS(
    hostels
      .command('add-room <hostel>')
      .description('add a room to a hostel')
      .requiredOption('--number <roomNumber>')
      .requiredOption('--capacity <number>')
      .option('--floor <number>', 'floor (0 = ground)', '0')
      .option('--amenities <list>', `comma separated: ${ROOM_AMENITIES.join(', ')}`, ''),
  ).action(
    asActor(async (actor) => {
      const command = hostels.commands.find((c) => c.name() === 'add-room');
      const options = command.opts();
      const hostel = hostelService.getHostel(command.args[0]);
      const room = hostelService.addRoom(
        {
          hostelId: hostel.id,
          roomNumber: options.number,
          floor: options.floor,
          capacity: options.capacity,
          amenities: parseAmenities(options.amenities),
        },
        actor,
      );
      print(success(`Room ${room.room_number} added to ${hostel.name} (${room.capacity} beds).`));
    }),
  );

  AUTH_OPTIONS(
    hostels
      .command('add-bed <roomId>')
      .description('add a bed to a room')
      .option('--label <label>', 'bed label (default: next B<n>)')
      .option('--bunk <level>', `one of: ${BUNK_LEVELS.join(', ')}`, 'SINGLE'),
  ).action(
    asActor(async (actor) => {
      const command = hostels.commands.find((c) => c.name() === 'add-bed');
      const options = command.opts();
      const bed = hostelService.addBed(
        { roomId: command.args[0], label: options.label, bunkLevel: options.bunk },
        actor,
      );
      print(success(`Bed ${bed.bed_label} (${bed.bunk_level}) added to room ${bed.room_number}.`));
    }),
  );

  AUTH_OPTIONS(
    hostels
      .command('amenities <roomId>')
      .description('replace a room\'s amenities')
      .requiredOption('--set <list>', `comma separated: ${ROOM_AMENITIES.join(', ')}`),
  ).action(
    asActor(async (actor) => {
      const command = hostels.commands.find((c) => c.name() === 'amenities');
      const room = hostelService.updateRoomAmenities(command.args[0], command.opts().set, actor);
      print(success(`Room ${room.room_number} amenities: ${room.amenities || '(none)'}.`));
    }),
  );

  AUTH_OPTIONS(
    hostels
      .command('room-status <roomId>')
      .description('open or close a room')
      .option('--close', 'close the room')
      .option('--open', 'open the room (default)'),
  ).action(
    asActor(async (actor) => {
      const command = hostels.commands.find((c) => c.name() === 'room-status');
      const open = !command.opts().close;
      const room = hostelService.setRoomAvailability(command.args[0], open, actor);
      print(success(`Room ${room.room_number} is now ${room.is_available === 1 ? 'open' : 'closed'}.`));
    }),
  );

  AUTH_OPTIONS(
    hostels
      .command('bed-status <bedId>')
      .description('disable or enable a bed')
      .option('--disable', 'disable the bed')
      .option('--enable', 'enable the bed (default)'),
  ).action(
    asActor(async (actor) => {
      const command = hostels.commands.find((c) => c.name() === 'bed-status');
      const enabled = !command.opts().disable;
      const bed = hostelService.setBedAvailability(command.args[0], enabled, actor);
      print(success(`Bed ${bed.room_number}/${bed.bed_label} is now ${bed.is_available === 1 ? 'available' : 'disabled'}.`));
    }),
  );

  const students = program.command('students').description('student operations');

  students
    .command('list')
    .description('list or search students')
    .option('-s, --search <text>', 'name or Student ID fragment')
    .option('-g, --gender <gender>', `one of: ${GENDERS.join(', ')}`)
    .option('-y, --year <yearForm>', `one of: ${YEAR_FORMS.join(', ')}`)
    .action((options) => {
      ensureDatabase();
      const rows = studentService.listStudents({
        search: options.search ?? null,
        gender: options.gender ?? null,
        yearForm: options.year ?? null,
      });
      print(
        table(
          rows.map((row) => ({
            ...row,
            needs: row.health_condition_count > 0 || row.has_health_notes ? 'yes' : 'no',
            placement: row.hostel_name ? `${row.hostel_name} ${row.room_number}/${row.bed_label} (${row.allocation_status})` : 'unallocated',
          })),
          [
            { key: 'student_code', header: 'Student ID' },
            { key: 'full_name', header: 'Name' },
            { key: 'gender', header: 'Gender' },
            { key: 'year_form', header: 'Year/Form' },
            { key: 'total_paid', header: 'Paid', align: 'right' },
            { key: 'needs', header: 'Needs' },
            { key: 'placement', header: 'Placement' },
          ],
          { empty: 'No students matched.' },
        ),
      );
    });

  students
    .command('show <student>')
    .description('student profile (health detail requires permission and --reveal)')
    .option('--reveal', 'reveal private health notes (audited)')
    .option('-u, --user <username>')
    .option('-p, --password <password>')
    .action(async (studentIdentifier, options) => {
      ensureDatabase();
      const student = studentService.resolveStudent(studentIdentifier);
      const fee = feeService.getFeeSummary(student.id);
      const allocation = allocationService.getActiveAllocation(student.id);

      const reveal = Boolean(options.reveal);
      const actor = reveal ? await resolveActor(options) : null;
      if (reveal && !can(actor.role, PERMISSIONS.HEALTH_REVEAL)) {
        throw new AppError('--reveal requires the health.reveal permission (admin or zomwe mukufuna).');
      }

      const health = studentService.getHealthProfile(student.id, {
        reveal,
        actor,
        reason: reveal ? 'cli --reveal' : null,
      });

      print(
        keyValue([
          ['Student ID', student.student_code],
          ['Name', student.full_name],
          ['Gender', student.gender],
          ['Year / Form', student.year_form],
          ['Phone', student.phone ?? '-'],
          ['Status', student.is_active === 1 ? 'active' : 'inactive'],
          ['Fees', `${fee.total_paid} of ${fee.required} ${fee.currency} (${fee.meetsRequirement ? 'eligible' : 'not eligible'})`],
          [
            'Accommodation',
            allocation ? `${allocation.hostel_name} ${allocation.room_number}/${allocation.bed_label} (${allocation.status})` : 'unallocated',
          ],
          ['Private notes', reveal ? health.health_notes ?? '-' : health.health_notes ? '[REDACTED]' : '-'],
        ]),
      );

      print(
        table(
          health.conditions.map((condition) => ({
            ...condition,
            meaning: requirementLabel(condition.code),
            notes: condition.notes ? (reveal ? condition.notes : '[REDACTED]') : '-',
          })),
          [
            { key: 'id', header: 'ID', align: 'right' },
            { key: 'code', header: 'Code' },
            { key: 'meaning', header: 'Meaning' },
            { key: 'level', header: 'Level' },
            { key: 'notes', header: 'Notes' },
          ],
          { empty: 'No structured health requirements.' },
        ),
      );
    });

  AUTH_OPTIONS(
    students
      .command('add')
      .description('register a student')
      .requiredOption('--code <studentCode>', 'Student ID / matriculation number')
      .requiredOption('--name <fullName>')
      .requiredOption('--gender <gender>', `one of: ${GENDERS.join(', ')}`)
      .requiredOption('--year <yearForm>', `one of: ${YEAR_FORMS.join(', ')}`)
      .option('--phone <phone>')
      .option('--email <email>')
      .option('--health-notes <text>', 'private notes (never printed without permission)'),
  ).action(
    asActor(async (actor) => {
      const command = students.commands.find((c) => c.name() === 'add');
      const options = command.opts();
      const student = studentService.registerStudent(
        {
          studentCode: options.code,
          fullName: options.name,
          gender: options.gender,
          yearForm: options.year,
          phone: options.phone,
          email: options.email,
          healthNotes: options.healthNotes,
        },
        actor,
      );
      print(success(`Student ${student.student_code} registered.`));
    }),
  );

  AUTH_OPTIONS(
    students
      .command('update <student>')
      .description('update a student record')
      .option('--name <fullName>')
      .option('--gender <gender>')
      .option('--year <yearForm>')
      .option('--phone <phone>')
      .option('--email <email>')
      .option('--activate', 'mark the student active')
      .option('--deactivate', 'mark the student inactive'),
  ).action(
    asActor(async (actor) => {
      const command = students.commands.find((c) => c.name() === 'update');
      const options = command.opts();
      const changes = {};
      if (options.name) changes.fullName = options.name;
      if (options.gender) changes.gender = options.gender;
      if (options.year) changes.yearForm = options.year;
      if (options.phone !== undefined) changes.phone = options.phone;
      if (options.email !== undefined) changes.email = options.email;
      if (options.deactivate) changes.isActive = false;
      if (options.activate) changes.isActive = true;
      const student = studentService.updateStudent(command.args[0], changes, actor);
      print(success(`${student.student_code} updated.`));
    }),
  );

  AUTH_OPTIONS(
    students
      .command('health-notes <student>')
      .description('set or clear a student\'s private health notes')
      .option('--set <text>', 'new notes')
      .option('--clear', 'remove the notes'),
  ).action(
    asActor(async (actor) => {
      const command = students.commands.find((c) => c.name() === 'health-notes');
      const options = command.opts();
      const student = studentService.setHealthNotes(command.args[0], options.clear ? null : options.set ?? null, actor);
      print(success(options.clear ? `Private notes cleared for ${student.student_code}.` : `Private notes saved for ${student.student_code}.`));
    }),
  );

  const requirements = students.command('requirements').description('health / sensitivity requirements');

  requirements
    .command('list <student>')
    .description('list the requirements recorded for a student')
    .action((studentIdentifier) => {
      ensureDatabase();
      const student = studentService.resolveStudent(studentIdentifier);
      const rows = studentService.getRequirements(student.id);
      print(
        table(
          rows.map((row) => ({ ...row, meaning: requirementLabel(row.code) })),
          [
            { key: 'id', header: 'ID', align: 'right' },
            { key: 'code', header: 'Code' },
            { key: 'meaning', header: 'Meaning' },
            { key: 'level', header: 'Level' },
          ],
          { empty: `${student.student_code} has no recorded requirements.` },
        ),
      );
    });

  AUTH_OPTIONS(
    requirements
      .command('add <student>')
      .description('record a requirement (required or preferred)')
      .requiredOption('--code <code>', `one of: ${HEALTH_REQUIREMENT_CODES.map((entry) => entry.code).join(', ')}`)
      .option('--level <level>', 'required or preferred', 'required')
      .option('--notes <text>', 'private note for this condition'),
  ).action(
    asActor(async (actor) => {
      const command = requirements.commands.find((c) => c.name() === 'add');
      const options = command.opts();
      studentService.addHealthCondition(
        {
          studentIdentifier: command.args[0],
          code: options.code,
          level: options.level,
          notes: options.notes,
        },
        actor,
      );
      print(success(`Requirement ${options.code} (${options.level}) recorded.`));
    }),
  );

  AUTH_OPTIONS(
    requirements
      .command('remove <conditionId>')
      .description('remove a recorded requirement')
      .option('--yes', 'do not ask for confirmation'),
  ).action(
    asActor(async (actor) => {
      const command = requirements.commands.find((c) => c.name() === 'remove');
      if (!command.opts().yes && process.stdin.isTTY) {
        const ok = await confirm(`Remove requirement #${command.args[0]}?`, false);
        if (!ok) {
          print(color.dim('Cancelled.'));
          return;
        }
      }
      studentService.removeHealthCondition(command.args[0], actor);
      print(success('Requirement removed.'));
    }),
  );

  AUTH_OPTIONS(
    students
      .command('deactivate <student>')
      .description('mark a student inactive (keeps history)'),
  ).action(
    asActor(async (actor) => {
      const command = students.commands.find((c) => c.name() === 'deactivate');
      const student = studentService.updateStudent(command.args[0], { isActive: false }, actor);
      print(success(`${student.student_code} deactivated.`));
    }),
  );

  AUTH_OPTIONS(
    students
      .command('delete <student>')
      .description('permanently delete a student with no history')
      .option('--yes', 'skip the confirmation prompt'),
  ).action(
    asActor(async (actor) => {
      const command = students.commands.find((c) => c.name() === 'delete');
      if (!command.opts().yes && process.stdin.isTTY) {
        const ok = await confirm(`Permanently delete student "${command.args[0]}"?`, false);
        if (!ok) {
          print(color.dim('Cancelled.'));
          return;
        }
      }
      studentService.deleteStudent(command.args[0], actor);
      print(success('Student deleted.'));
    }),
  );

  const fees = program.command('fees').description('fee operations');

  AUTH_OPTIONS(
    fees
      .command('add <student>')
      .description('record a fee payment')
      .requiredOption('--amount <amount>')
      .option('--type <feeType>', 'first_deposit | balance | other', 'first_deposit')
      .option('--method <method>', 'Cash | Bank transfer | Mobile money | Cheque | Other', 'Cash')
      .option('--reference <reference>')
      .option('--date <yyyy-mm-dd>')
      .option('--note <text>'),
  ).action(
    asActor(async (actor) => {
      const command = fees.commands.find((c) => c.name() === 'add');
      const options = command.opts();
      const { summary, payment } = feeService.recordPayment(
        {
          studentIdentifier: command.args[0],
          amount: options.amount,
          feeType: options.type,
          method: options.method,
          reference: options.reference,
          paidOn: options.date,
          note: options.note,
        },
        actor,
      );
      print(success(`Payment #${payment.id} of ${payment.amount} recorded.`));
      print(
        `  Total: ${summary.total_paid} ${summary.currency} of ${summary.required} required - ${
          summary.meetsRequirement ? 'ELIGIBLE' : 'NOT ELIGIBLE'
        }`,
      );
    }),
  );

  fees
    .command('list <student>')
    .description('list a student\'s payments')
    .action((studentIdentifier) => {
      ensureDatabase();
      const student = studentService.resolveStudent(studentIdentifier);
      const currency = settingsService.getCurrency();
      const summary = feeService.getFeeSummary(student.id);
      print(
        table(feeService.listPayments(student.id), [
          { key: 'id', header: 'ID', align: 'right' },
          { key: 'paid_on', header: 'Date' },
          { key: 'amount', header: `Amount (${currency})`, align: 'right' },
          { key: 'fee_type', header: 'Type' },
          { key: 'method', header: 'Method' },
          { key: 'reference', header: 'Reference' },
        ], { empty: 'No payments recorded.' }),
      );
      print(
        `\n  Total: ${summary.total_paid} ${currency} | required: ${summary.required} ${currency} | ${
          summary.meetsRequirement ? 'ELIGIBLE' : 'NOT ELIGIBLE'
        }`,
      );
    });

  fees
    .command('status')
    .description('fee status for every student')
    .option('--shortfall', 'only students below the requirement')
    .action((options) => {
      ensureDatabase();
      const currency = settingsService.getCurrency();
      const rows = feeService.feeStatusReport({ onlyShortfall: Boolean(options.shortfall) });
      print(
        table(rows, [
          { key: 'student_code', header: 'Student ID' },
          { key: 'full_name', header: 'Name' },
          { key: 'year_form', header: 'Year/Form' },
          { key: 'total_paid', header: `Paid (${currency})`, align: 'right' },
          { key: 'required', header: 'Required', align: 'right' },
          {
            key: 'meetsRequirement',
            header: 'Status',
            format: (row) => (row.meetsRequirement ? 'eligible' : `short ${row.shortfall}`),
          },
        ], { empty: 'No students registered.' }),
      );
    });

  AUTH_OPTIONS(
    fees
      .command('delete <paymentId>')
      .description('delete a payment record (correction)')
      .option('--yes', 'skip the confirmation prompt'),
  ).action(
    asActor(async (actor) => {
      const command = fees.commands.find((c) => c.name() === 'delete');
      if (!command.opts().yes && process.stdin.isTTY) {
        const ok = await confirm(`Delete payment #${command.args[0]}?`, false);
        if (!ok) {
          print(color.dim('Cancelled.'));
          return;
        }
      }
      const summary = feeService.deletePayment(command.args[0], actor);
      print(success(`Payment deleted. New total: ${summary.total_paid} ${summary.currency}.`));
    }),
  );

  program
    .command('eligibility <student>')
    .description('explain why a student is (or is not) eligible for allocation')
    .action((studentIdentifier) => {
      ensureDatabase();
      const verdict = eligibilityService.assessStudent(studentIdentifier);
      const currency = settingsService.getCurrency();
      print(
        heading(`${verdict.student.full_name} (${verdict.student.student_code}) - ${verdict.student.gender}, ${verdict.student.year_form}`),
      );
      print(
        keyValue([
          ['Verdict', verdict.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'],
          ['Fees', `${verdict.fee.total_paid} of ${verdict.fee.required} ${currency}`],
          ['Hostels that can take the student', String(verdict.placeable.length)],
        ]),
      );
      for (const reason of verdict.reasons) print(`  x ${reason}`);
      print(
        table(
          verdict.hostels.map((entry) => ({
            hostel: entry.hostel.name,
            rule: hostelService.hostelRuleText(entry.hostel),
            free: entry.freeBeds,
            suitable: entry.suitableBeds,
            verdict: entry.eligible ? 'OK' : 'NO',
          })),
          [
            { key: 'hostel', header: 'Hostel' },
            { key: 'rule', header: 'Rule' },
            { key: 'free', header: 'Free beds', align: 'right' },
            { key: 'suitable', header: 'Suitable', align: 'right' },
            { key: 'verdict', header: 'Verdict' },
          ],
          { empty: 'No hostels registered.' },
        ),
      );
    });

  AUTH_OPTIONS(
    program
      .command('allocate <student>')
      .description('automatically assign the best suitable bed')
      .option('-H, --hostel <hostel>', 'restrict to one hostel'),
  ).action(
    asActor(async (actor) => {
      const command = program.commands.find((c) => c.name() === 'allocate');
      const options = command.opts();
      const hostel = options.hostel ? hostelService.getHostel(options.hostel) : null;
      const allocation = allocationService.autoAllocate(command.args[0], actor, {
        hostelIdentifier: hostel?.id ?? null,
      });
      print(
        success(
          `Allocated ${allocation.student_code} to ${allocation.hostel_name} room ${allocation.room_number}, bed ${allocation.bed_label} (allocation #${allocation.id}).`,
        ),
      );
      if (allocation.notes) print(color.dim(`  ${allocation.notes}`));
      print(color.dim('  Reminder: check the student in when they arrive.'));
    }),
  );

  AUTH_OPTIONS(
    program
      .command('assign <student>')
      .description('assign a student to a specific bed')
      .requiredOption('--bed <bedId>')
      .option('--override', 'allow placement when only preferred conditions are unmet')
      .option('--reason <text>', 'reason for a manual override (recorded)'),
  ).action(
    asActor(async (actor) => {
      const command = program.commands.find((c) => c.name() === 'assign');
      const options = command.opts();
      const allocation = allocationService.allocateToBed(command.args[0], options.bed, actor, {
        confirmOverride: Boolean(options.override),
        reason: options.reason ?? null,
      });
      print(
        success(
          `Assigned ${allocation.student_code} to ${allocation.hostel_name} room ${allocation.room_number}, bed ${allocation.bed_label}.`,
        ),
      );
    }),
  );

  AUTH_OPTIONS(
    program
      .command('suggest <student>')
      .description('list and rank the free beds that suit a student')
      .option('-n, --limit <number>', 'how many rows', '20'),
  ).action(
    asActor(async (actor) => {
      const command = program.commands.find((c) => c.name() === 'suggest');
      const options = command.opts();
      const ranked = allocationService.findCandidateBeds(command.args[0]);
      if (!ranked.candidates.length) {
        print(warn('No free bed satisfies every required condition for this student.'));
      }
      print(
        table(
          ranked.candidates
            .sort((a, b) => b.evaluation.score - a.evaluation.score)
            .slice(0, Number(options.limit))
            .map((candidate) => ({
              bedId: candidate.bed.bed_id,
              hostel: candidate.bed.hostel_name,
              room: candidate.bed.room_number,
              bed: candidate.bed.bed_label,
              bunk: candidate.bed.bunk_level,
              floor: candidate.bed.floor,
              preferences: candidate.evaluation.metPreferred.join(', ') || '-',
              unmet: candidate.evaluation.unmetPreferred.join(', ') || '-',
            })),
          [
            { key: 'bedId', header: 'Bed ID', align: 'right' },
            { key: 'hostel', header: 'Hostel' },
            { key: 'room', header: 'Room' },
            { key: 'bed', header: 'Bed' },
            { key: 'bunk', header: 'Bunk' },
            { key: 'floor', header: 'Floor', align: 'right' },
            { key: 'preferences', header: 'Preferences met' },
            { key: 'unmet', header: 'Preferences unmet' },
          ],
          { empty: 'No candidate beds.' },
        ),
      );
      print(color.dim(`\n  ${ranked.rejected.length} bed(s) rejected by gender/year/health rules.`));
      void actor;
    }),
  );

  AUTH_OPTIONS(
    program
      .command('move <student>')
      .description('move an assigned student (not yet checked in) to another bed')
      .requiredOption('--bed <bedId>'),
  ).action(
    asActor(async (actor) => {
      const command = program.commands.find((c) => c.name() === 'move');
      const allocation = allocationService.reassignBed(command.args[0], command.opts().bed, actor);
      print(success(`Moved ${allocation.student_code} to ${allocation.hostel_name} ${allocation.room_number}/${allocation.bed_label}.`));
    }),
  );

  AUTH_OPTIONS(
    program
      .command('cancel <allocationId>')
      .description('cancel an assignment and free the bed')
      .option('--reason <text>'),
  ).action(
    asActor(async (actor) => {
      const command = program.commands.find((c) => c.name() === 'cancel');
      allocationService.cancelAllocation(command.args[0], actor, { reason: command.opts().reason ?? null });
      print(success(`Allocation #${command.args[0]} cancelled; the bed is free again.`));
    }),
  );

  AUTH_OPTIONS(
    program
      .command('checkin <student>')
      .description('check a student in to their assigned bed')
      .option('--override', 'allow check-in despite an incomplete deposit (supervisor only)')
      .option('--note <text>'),
  ).action(
    asActor(async (actor) => {
      const command = program.commands.find((c) => c.name() === 'checkin');
      const options = command.opts();
      if (options.override && !can(actor.role, PERMISSIONS.HOSTEL_MANAGE)) {
        throw new AppError('Overriding the fee requirement requires the zomwe mukufuna or administrator role.');
      }
      const allocation = stayService.checkIn(command.args[0], actor, {
        allowIneligible: Boolean(options.override),
        note: options.note ?? null,
      });
      print(
        success(
          `Checked in ${allocation.student_code} to ${allocation.hostel_name} ${allocation.room_number}/${allocation.bed_label}.`,
        ),
      );
      if (options.override) print(warn('Recorded as a supervisor override (fee deposit incomplete).'));
    }),
  );

  AUTH_OPTIONS(
    program
      .command('checkout <student>')
      .description('check a student out and free the bed')
      .option('--note <text>')
      .option('--cancel', 'cancel the assignment if the student never checked in'),
  ).action(
    asActor(async (actor) => {
      const command = program.commands.find((c) => c.name() === 'checkout');
      const options = command.opts();
      const allocation = stayService.checkOut(command.args[0], actor, {
        note: options.note ?? null,
        cancelIfAssigned: Boolean(options.cancel),
      });
      print(
        success(
          `${allocation.status === 'cancelled' ? 'Assignment cancelled' : 'Checked out'}: ${allocation.student_code}; bed ${allocation.room_number}/${allocation.bed_label} is free again.`,
        ),
      );
    }),
  );

  program
    .command('logs')
    .description('check-in / check-out movement log')
    .option('-n, --limit <number>', 'how many entries', '25')
    .action((options) => {
      ensureDatabase();
      print(
        table(stayService.listStayLogs({ limit: Number(options.limit) }), [
          { key: 'id', header: 'ID', align: 'right' },
          { key: 'at', header: 'When' },
          { key: 'action', header: 'Action' },
          { key: 'student_code', header: 'Student ID' },
          { key: 'student_name', header: 'Name' },
          { key: 'hostel_name', header: 'Hostel' },
          { key: 'room_number', header: 'Room' },
          { key: 'bed_label', header: 'Bed' },
          { key: 'actor', header: 'By' },
        ], { empty: 'No movements recorded.' }),
      );
    });

  const users = program.command('users').description('system users');

  users
    .command('list')
    .description('list system users')
    .action(() => {
      ensureDatabase();
      print(
        table(authService.listUsers(), [
          { key: 'id', header: 'ID', align: 'right' },
          { key: 'username', header: 'Username' },
          { key: 'full_name', header: 'Full name' },
          { key: 'role', header: 'Role' },
          { key: 'active', header: 'Active' },
          { key: 'last_login_at', header: 'Last login' },
        ], { empty: 'No users.' }),
      );
    });

  users
    .command('add')
    .description('create a user (the first user needs no authentication)')
    .requiredOption('--username <username>')
    .requiredOption('--name <fullName>')
    .requiredOption('--role <role>', `one of: ${Object.values(ROLE_NAMES).join(', ')}`)
    .requiredOption('--password <password>')
    .option('-u, --user <username>')
    .option('-p, --password-auth <password>', 'password of the acting administrator')
    .action(async (options) => {
      ensureDatabase();
      let actor = null;
      if (authService.countUsers() > 0) {
        actor = await resolveActor({ user: options.user, password: options.passwordAuth });
      }
      const user = authService.createUser(
        { username: options.username, fullName: options.name, role: options.role, password: options.password },
        actor,
      );
      print(success(`User "${user.username}" created with role ${user.role}.`));
    });

  AUTH_OPTIONS(
    users
      .command('passwd <username>')
      .description('reset a user\'s password')
      .requiredOption('--new-password <password>'),
  ).action(
    asActor(async (actor) => {
      const command = users.commands.find((c) => c.name() === 'passwd');
      const user = authService.getByUsername(command.args[0]);
      if (!user) throw new AppError(`User "${command.args[0]}" was not found.`);
      authService.resetPassword(user.id, command.opts().newPassword, actor);
      print(success(`Password reset for "${user.username}".`));
    }),
  );

  AUTH_OPTIONS(
    users
      .command('role <username>')
      .description('change a user\'s role')
      .requiredOption('--role <role>', `one of: ${Object.values(ROLE_NAMES).join(', ')}`),
  ).action(
    asActor(async (actor) => {
      const command = users.commands.find((c) => c.name() === 'role');
      const user = authService.getByUsername(command.args[0]);
      if (!user) throw new AppError(`User "${command.args[0]}" was not found.`);
      const updated = authService.updateUserRole(user.id, command.opts().role, actor);
      print(success(`${updated.username} is now ${updated.role}.`));
    }),
  );

  AUTH_OPTIONS(
    users
      .command('active <username>')
      .description('enable or disable a user')
      .option('--disable', 'disable the account')
      .option('--enable', 'enable the account (default)'),
  ).action(
    asActor(async (actor) => {
      const command = users.commands.find((c) => c.name() === 'active');
      const user = authService.getByUsername(command.args[0]);
      if (!user) throw new AppError(`User "${command.args[0]}" was not found.`);
      const updated = authService.setActive(user.id, !command.opts().disable, actor);
      print(success(`${updated.username} is now ${updated.active === 1 ? 'active' : 'disabled'}.`));
    }),
  );

  const settings = program.command('settings').description('policy settings');

  settings
    .command('list')
    .description('show all settings')
    .action(() => {
      ensureDatabase();
      print(
        table(settingsService.listSettings(), [
          { key: 'key', header: 'Key' },
          { key: 'value', header: 'Value' },
          { key: 'label', header: 'Description' },
        ]),
      );
    });

  AUTH_OPTIONS(
    settings
      .command('set <key> <value>')
      .description('change a setting (e.g. first_deposit_amount 75000)'),
  ).action(
    asActor(async (actor) => {
      const command = settings.commands.find((c) => c.name() === 'set');
      const [key, value] = command.args;
      const updated = settingsService.setSetting(key, value, { actor });
      print(success(`${updated.key} = ${updated.value}`));
    }),
  );

  AUTH_OPTIONS(program.command('setup').description('quick policy setup (deposit + institution)')).action(
    asActor(async (actor) => {
      await quickSetup(actor);
    }),
  );

  program
    .command('roles')
    .description('show roles and their permissions')
    .action(() => {
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
    });

  program
    .command('db-info')
    .description('database location and row counts')
    .action(async () => {
      ensureDatabase();
      const { DB_PATH } = await import('../config.js');
      print(
        keyValue([
          ['Database file', DB_PATH],
          ['Users', String(authService.countUsers())],
          ['Hostels', String(hostelService.listHostels().length)],
          ['Students', String(studentService.listStudents().length)],
          ['Allocations', String(allocationService.listAllocations({ limit: 1000 }).length)],
        ]),
      );
    });

  program.configureOutput({
    writeErr: (str) => process.stderr.write(str),
  });

  return program;
}

export { closeDatabase, ValidationError, printError };
