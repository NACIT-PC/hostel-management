/**
 * Hostel inventory menu: hostels, rooms and beds.
 */
import { HOSTEL_GENDERS, HOSTEL_CATEGORIES, ROOM_AMENITIES, BUNK_LEVELS, LIMITS, ALL_YEARS } from '../../config.js';
import { PERMISSIONS } from '../../security/permissions.js';
import * as hostelService from '../../services/hostelService.js';
import { color, keyValue, print, section, success, table, warn, money, dateTime } from '../ui.js';
import { confirm, integer, multiSelect, select, text, yesNo } from '../prompts.js';
import { runMenu, pickHostel, BACK } from './common.js';

export async function hostelMenu(actor) {
  await runMenu({
    title: 'Hostel inventory',
    actor,
    options: [
      {
        label: 'List hostels',
        value: 'list',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => {
          const hostels = hostelService.listHostels();
          if (!hostels.length) print(color.dim('No hostels registered yet.'));
          else {
            print(color.bold(`${hostels.length} hostel(s)`));
            printHostelsDetailed(hostels);
          }
        },
      },
      {
        label: 'Register a new hostel',
        value: 'create',
        permission: PERMISSIONS.HOSTEL_MANAGE,
        run: () => createHostelFlow(actor),
      },
      {
        label: 'View hostel details (rooms & beds)',
        value: 'detail',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => detailFlow(),
      },
      {
        label: 'Edit hostel (name / gender / year restriction)',
        value: 'edit',
        permission: PERMISSIONS.HOSTEL_MANAGE,
        run: () => editHostelFlow(actor),
      },
      {
        label: 'Add a room',
        value: 'add-room',
        permission: PERMISSIONS.ROOM_MANAGE,
        run: () => addRoomFlow(actor),
      },
      {
        label: 'Add a bed to a room',
        value: 'add-bed',
        permission: PERMISSIONS.ROOM_MANAGE,
        run: () => addBedFlow(actor),
      },
      {
        label: 'Update room amenities (health matching)',
        value: 'amenities',
        permission: PERMISSIONS.ROOM_MANAGE,
        run: () => amenitiesFlow(actor),
      },
      {
        label: 'Open / close a room',
        value: 'toggle-room',
        permission: PERMISSIONS.ROOM_MANAGE,
        run: () => toggleRoomFlow(actor),
      },
      {
        label: 'Open / close a bed',
        value: 'toggle-bed',
        permission: PERMISSIONS.ROOM_MANAGE,
        run: () => toggleBedFlow(actor),
      },
      {
        label: 'Remove a bed or room',
        value: 'remove',
        permission: PERMISSIONS.ROOM_MANAGE,
        run: () => removeFlow(actor),
      },
      {
        label: 'Inventory consistency check',
        value: 'verify',
        permission: PERMISSIONS.REPORT_VIEW,
        run: () => {
          const rows = hostelService.verifyInventory();
          print(table(rows, [
            { key: 'name', header: 'Hostel' },
            { key: 'declared_rooms', header: 'Declared rooms', align: 'right' },
            { key: 'actual_rooms', header: 'Actual rooms', align: 'right' },
            { key: 'declared_beds', header: 'Declared beds', align: 'right' },
            { key: 'actual_beds', header: 'Actual beds', align: 'right' },
            {
              key: 'consistent',
              header: 'State',
              format: (row) => (row.consistent ? color.green('consistent') : color.red('MISMATCH')),
            },
          ]));
        },
      },
    ],
  });
}

function printHostelsDetailed(hostels) {
  print(
    table(hostels, [
      { key: 'id', header: 'ID', align: 'right' },
      { key: 'name', header: 'Hostel' },
      { key: 'gender', header: 'Gender', format: (row) => (row.gender === 'Mixed' ? 'Mixed' : `${row.gender} only`) },
      { key: 'category', header: 'Year/Form', format: (row) => (row.category === ALL_YEARS ? 'All' : row.category) },
      { key: 'actual_rooms', header: 'Rooms', align: 'right' },
      { key: 'actual_beds', header: 'Beds', align: 'right' },
      { key: 'occupied_beds', header: 'Occupied', align: 'right' },
      { key: 'free_beds', header: 'Free', align: 'right' },
      { key: 'description', header: 'Notes', format: (row) => row.description ?? color.dim('-') },
    ]),
  );
}

async function createHostelFlow(actor) {
  print(color.dim('  A hostel gets rooms and beds generated automatically from the totals below.'));

  const name = await text('Hostel name', { field: 'Hostel name', max: 80 });
  const gender = await select('Hostel accepts', HOSTEL_GENDERS.map((value) => ({ name: value, value })));
  const category = await select(
    'Year / form restriction',
    [
      { name: 'All years / forms', value: ALL_YEARS },
      ...HOSTEL_CATEGORIES.filter((item) => item !== ALL_YEARS).map((item) => ({ name: `Only ${item}`, value: item })),
    ],
  );
  const totalRooms = await integer('Number of rooms', { field: 'Number of rooms', min: 1, max: LIMITS.MAX_ROOMS_PER_HOSTEL });
  const totalBeds = await integer('Total number of beds', {
    field: 'Total number of beds',
    min: totalRooms,
    max: totalRooms * LIMITS.MAX_BEDS_PER_ROOM,
  });
  const roomsPerFloor = await integer('Rooms per floor', {
    field: 'Rooms per floor',
    min: 1,
    default: LIMITS.DEFAULT_ROOMS_PER_FLOOR,
  });
  const description = await text('Description (optional)', { field: 'Description', optional: true, max: 400 });

  print(
    color.dim(
      `\n  Plan: ${name} | ${gender} | ${category} | ${totalRooms} rooms / ${totalBeds} beds | ${roomsPerFloor} rooms per floor`,
    ),
  );
  const ok = await confirm('Create this hostel?', true);
  if (!ok) {
    print(color.dim('Cancelled.'));
    return;
  }

  const hostel = hostelService.createHostel(
    { name, gender, category, totalRooms, totalBeds, roomsPerFloor, description },
    actor,
  );
  print(success(`Hostel "${hostel.name}" created with ${hostel.total_rooms} rooms and ${hostel.total_beds} beds.`));
  print(color.dim('  Beds are labelled B1, B2, ... - B1 is a lower bunk in shared rooms.'));
}

async function detailFlow() {
  const hostel = await pickHostel();
  if (!hostel) return;

  const rooms = hostelService.listRooms(hostel.id);
  const beds = hostelService.listBeds(hostel.id);
  print(
    keyValue([
      ['Hostel', `${hostel.name} (ID ${hostel.id})`],
      ['Rule', hostelService.hostelRuleText(hostel)],
      ['Rooms', `${rooms.length} (declared ${hostel.total_rooms})`],
      ['Beds', `${beds.length} (declared ${hostel.total_beds})`],
      ['Description', hostel.description ?? color.dim('-')],
      ['Created', dateTime(hostel.created_at)],
    ]),
  );

  let selectedRoomId = null;
  const showAll = await select('Display', [
    { name: 'All rooms and beds', value: 'all' },
    { name: 'One room in detail', value: 'one' },
  ]);

  if (showAll === 'one') {
    if (!rooms.length) {
      print(warn('This hostel has no rooms yet.'));
      return;
    }
    const choice = await select(
      'Room',
      rooms.map((room) => ({
        name: `Room ${room.room_number} (floor ${room.floor}${room.floor === 0 ? ' / ground' : ''}) - ${room.bed_count} bed(s), ${room.occupied_beds} occupied`,
        value: room.id,
      })),
    );
    selectedRoomId = choice;
  }

  print(section('Rooms'));
  print(
    table(
      selectedRoomId ? rooms.filter((room) => room.id === selectedRoomId) : rooms,
      [
        { key: 'id', header: 'Room ID', align: 'right' },
        { key: 'room_number', header: 'Room' },
        { key: 'floor', header: 'Floor', align: 'right', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
        { key: 'capacity', header: 'Capacity', align: 'right' },
        { key: 'bed_count', header: 'Beds', align: 'right' },
        { key: 'occupied_beds', header: 'Occupied', align: 'right' },
        { key: 'amenities', header: 'Amenities', format: (row) => row.amenities || color.dim('-') },
        {
          key: 'is_available',
          header: 'State',
          format: (row) => (row.is_available === 1 ? color.green('open') : color.yellow('closed')),
        },
      ],
      { empty: 'No rooms yet.' },
    ),
  );

  print(section('Beds'));
  const bedRows = selectedRoomId
    ? hostelService.listBedsInRoom(selectedRoomId)
    : beds.map((bed) => ({ ...bed, room_number: bed.room_number, bed_label: bed.bed_label }));
  if (!bedRows.length) {
    print(color.dim('No beds yet.'));
  } else {
    print(
      table(
        bedRows.map((bed) => ({
          ...bed,
          state: bed.is_occupied
            ? `${color.red('occupied')} ${color.dim(`by ${bed.student_code}`)}`
            : bed.is_available === 1
              ? color.green('free')
              : color.yellow('disabled'),
        })),
        [
          { key: 'id', header: 'Bed ID', align: 'right' },
          { key: 'room_number', header: 'Room' },
          { key: 'label', header: 'Bed' },
          { key: 'bunk_level', header: 'Bunk' },
          { key: 'floor', header: 'Floor', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
          { key: 'state', header: 'Status', format: (row) => row.state },
        ],
      ),
    );
  }
}

async function editHostelFlow(actor) {
  const hostel = await pickHostel();
  if (!hostel) return;

  const field = await select('What do you want to change?', [
    { name: 'Hostel name', value: 'name' },
    { name: 'Gender rule', value: 'gender' },
    { name: 'Year / form restriction', value: 'category' },
    { name: 'Description', value: 'description' },
  ]);

  const changes = {};
  if (field === 'name') changes.name = await text('New name', { field: 'Hostel name', default: hostel.name, max: 80 });
  if (field === 'gender') changes.gender = await select('New gender rule', HOSTEL_GENDERS.map((v) => ({ name: v, value: v })));
  if (field === 'category') {
    changes.category = await select('New restriction', [
      { name: 'All years / forms', value: ALL_YEARS },
      ...HOSTEL_CATEGORIES.filter((item) => item !== ALL_YEARS).map((item) => ({ name: `Only ${item}`, value: item })),
    ]);
  }
  if (field === 'description') {
    changes.description = await text('New description', { field: 'Description', default: hostel.description ?? '', optional: true, max: 400 });
  }

  const updated = hostelService.updateHostelFields(hostel.id, changes, actor);
  print(success(`Hostel updated: ${updated.name} (${hostelService.hostelRuleText(updated)}).`));
  if (field === 'gender' || field === 'category') {
    print(
      warn(
        'Changing the rule does not move existing residents. Re-check current placements from Reports > Students by room.',
      ),
    );
  }
}

async function addRoomFlow(actor) {
  const hostel = await pickHostel();
  if (!hostel) return;

  const roomNumber = await text('Room number', { field: 'Room number', max: 20 });
  const floor = await integer('Floor (0 = ground floor)', { field: 'Floor', min: 0, default: 0 });
  const capacity = await integer('Number of beds in this room', {
    field: 'Capacity',
    min: 1,
    max: LIMITS.MAX_BEDS_PER_ROOM,
    default: 2,
  });
  const amenities = await multiSelect(
    'Room amenities (used to match health requirements)',
    ROOM_AMENITIES.map((item) => ({ name: item.replace(/_/g, ' ').toLowerCase(), value: item })),
  );

  const room = hostelService.addRoom(
    { hostelId: hostel.id, roomNumber, floor, capacity, amenities: amenities.join(',') },
    actor,
  );
  print(success(`Room ${room.room_number} added to ${hostel.name} with ${capacity} bed(s).`));
}

async function addBedFlow(actor) {
  const hostel = await pickHostel();
  if (!hostel) return;
  const rooms = hostelService.listRooms(hostel.id);
  if (!rooms.length) {
    print(warn('Add a room first.'));
    return;
  }
  const roomId = await select(
    'Room',
    rooms.map((room) => ({ name: `Room ${room.room_number} (${room.bed_count} bed(s))`, value: room.id })),
  );
  const label = await text('Bed label (e.g. B3)', { field: 'Bed label', optional: true, max: 12 });
  const bunkLevel = await select('Bunk level', BUNK_LEVELS.map((level) => ({ name: level.toLowerCase(), value: level })));

  const bed = hostelService.addBed({ roomId, label, bunkLevel }, actor);
  print(success(`Bed ${bed.bed_label} (${bed.bunk_level}) added to room ${bed.room_number}.`));
}

async function amenitiesFlow(actor) {
  const hostel = await pickHostel();
  if (!hostel) return;
  const rooms = hostelService.listRooms(hostel.id);
  if (!rooms.length) {
    print(warn('This hostel has no rooms.'));
    return;
  }
  const roomId = await select('Room', rooms.map((room) => ({
    name: `Room ${room.room_number} ${color.dim(room.amenities || '(no amenities)')}`,
    value: room.id,
  })));
  const room = rooms.find((item) => item.id === roomId);
  const current = (room.amenities || '').split(',').filter(Boolean);
  const amenities = await multiSelect(
    'Amenities (space to toggle, enter to save)',
    ROOM_AMENITIES.map((item) => ({ name: item.replace(/_/g, ' ').toLowerCase(), value: item })),
    { default: current },
  );
  const updated = hostelService.updateRoomAmenities(roomId, amenities.join(','), actor);
  print(success(`Room ${updated.room_number} amenities: ${updated.amenities || '(none)'}.`));
  print(color.dim('  Ground-floor rooms automatically satisfy the GROUND_FLOOR requirement.'));
}

async function toggleRoomFlow(actor) {
  const hostel = await pickHostel();
  if (!hostel) return;
  const rooms = hostelService.listRooms(hostel.id);
  const roomId = await select(
    'Room',
    rooms.map((room) => ({
      name: `Room ${room.room_number} - ${room.is_available === 1 ? color.green('open') : color.yellow('closed')}`,
      value: room.id,
    })),
  );
  const room = rooms.find((item) => item.id === roomId);
  const open = await yesNo(`Keep room ${room.room_number} open for allocation?`, { default: room.is_available === 1 });
  const updated = hostelService.setRoomAvailability(roomId, open, actor);
  print(success(`Room ${updated.room_number} is now ${updated.is_available === 1 ? 'open' : 'closed'}.`));
}

async function toggleBedFlow(actor) {
  const hostel = await pickHostel();
  if (!hostel) return;
  const rooms = hostelService.listRooms(hostel.id);
  const roomId = await select(
    'Room',
    rooms.map((room) => ({ name: `Room ${room.room_number} (${room.bed_count} bed(s))`, value: room.id })),
  );
  const beds = hostelService.listBedsInRoom(roomId);
  if (!beds.length) {
    print(warn('That room has no beds.'));
    return;
  }
  const bedId = await select(
    'Bed',
    beds.map((bed) => ({
      name: `${bed.label} (${bed.bunk_level}) - ${bed.is_occupied ? color.red('occupied') : bed.is_available === 1 ? color.green('free') : color.yellow('disabled')}`,
      value: bed.id,
    })),
  );
  const bed = beds.find((item) => item.id === bedId);
  const enabled = await yesNo(`Keep bed ${bed.label} available?`, { default: bed.is_available === 1 });
  const updated = hostelService.setBedAvailability(bedId, enabled, actor);
  print(success(`Bed ${updated.bed_label} is now ${updated.is_available === 1 ? 'available' : 'disabled'}.`));
}

async function removeFlow(actor) {
  const hostel = await pickHostel();
  if (!hostel) return;
  const what = await select('What do you want to remove?', [
    { name: 'A bed', value: 'bed' },
    { name: 'A room (and all its beds)', value: 'room' },
  ]);

  if (what === 'bed') {
    const rooms = hostelService.listRooms(hostel.id);
    const roomId = await select('Room', rooms.map((room) => ({ name: `Room ${room.room_number}`, value: room.id })));
    const beds = hostelService.listBedsInRoom(roomId);
    if (!beds.length) {
      print(warn('That room has no beds.'));
      return;
    }
    const bedId = await select('Bed', beds.map((bed) => ({ name: `${bed.label} (${bed.bunk_level})`, value: bed.id })));
    if (!(await confirm('Really delete this bed?', false))) {
      print(color.dim('Cancelled.'));
      return;
    }
    hostelService.removeBed(bedId, actor);
    print(success('Bed deleted.'));
    return;
  }

  const rooms = hostelService.listRooms(hostel.id);
  const roomId = await select(
    'Room',
    rooms.map((room) => ({ name: `Room ${room.room_number} - ${room.bed_count} bed(s)`, value: room.id })),
  );
  if (!(await confirm('Really delete this room and all of its beds?', false))) {
    print(color.dim('Cancelled.'));
    return;
  }
  hostelService.removeRoom(roomId, actor);
  print(success('Room deleted.'));
}
