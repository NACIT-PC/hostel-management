import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshSetup,
  createStudent,
  hostelService,
  allocationService,
  stayService,
  getDb,
} from './helpers.js';

function setup() {
  const actors = freshSetup();
  const hostel = hostelService.createHostel(
    { name: 'Lifecycle Hall', gender: 'Male', category: 'ALL', totalRooms: 1, totalBeds: 2, roomsPerFloor: 1 },
    actors.admin,
  );
  return { actors, hostel };
}

test('a student cannot hold two active allocations', () => {
  const { actors } = setup();
  const student = createStudent(actors, 'A-1', { pay: 50000 });

  allocationService.autoAllocate(student.id, actors.warden);
  assert.throws(
    () => allocationService.autoAllocate(student.id, actors.warden),
    (error) => error.code === 'CONFLICT',
  );
});

test('an occupied bed is refused by the allocator', () => {
  const { actors } = setup();
  const first = createStudent(actors, 'B-1', { pay: 50000 });
  const second = createStudent(actors, 'B-2', { pay: 50000 });

  const allocation = allocationService.autoAllocate(first.id, actors.warden);
  assert.throws(
    () => allocationService.allocateToBed(second.id, allocation.bed_id, actors.warden),
    (error) => error.code === 'NOT_ELIGIBLE' && /occupied/i.test(error.details.join(' ')),
  );
});

test('the database refuses two active allocations for the same bed', () => {
  const { actors } = setup();
  const first = createStudent(actors, 'D-1', { pay: 50000 });
  const second = createStudent(actors, 'D-2', { pay: 50000 });

  const allocation = allocationService.allocateToBed(first.id, hostelService.listFreeBeds()[0].bed_id, actors.warden);

  const insert = getDb().prepare(
    "INSERT INTO allocations (student_id, bed_id, status, assigned_by) VALUES (?, ?, 'assigned', ?)",
  );
  assert.throws(() => insert.run(second.id, allocation.bed_id, actors.warden.id), /UNIQUE/i);

  allocationService.cancelAllocation(allocation.id, actors.warden);
  assert.doesNotThrow(() => insert.run(second.id, allocation.bed_id, actors.warden.id));
});

test('check-in and check-out move a student through the full lifecycle', () => {
  const { actors, hostel } = setup();
  const student = createStudent(actors, 'C-1', { pay: 50000 });

  const allocation = allocationService.autoAllocate(student.id, actors.warden);
  assert.equal(allocation.status, 'assigned');
  assert.equal(hostelService.listFreeBeds({ hostelId: hostel.id }).length, 1);

  const checkedIn = stayService.checkIn(student.id, actors.warden);
  assert.equal(checkedIn.status, 'checked_in');
  assert.equal(stayService.currentResidents({ hostelId: hostel.id }).length, 1);
  assert.equal(hostelService.listFreeBeds({ hostelId: hostel.id }).length, 1);

  assert.throws(
    () => stayService.checkIn(student.id, actors.warden),
    (error) => error.code === 'CONFLICT',
  );

  const checkedOut = stayService.checkOut(student.id, actors.warden);
  assert.equal(checkedOut.status, 'checked_out');
  assert.equal(stayService.currentResidents({ hostelId: hostel.id }).length, 0);
  assert.equal(hostelService.listFreeBeds({ hostelId: hostel.id }).length, 2);

  const logs = stayService.listStayLogs({ studentIdentifier: student.id });
  assert.deepEqual(
    logs.map((row) => row.action),
    ['checked_out', 'checked_in'],
  );
});

test('an assigned bed must be cancelled explicitly, not checked out', () => {
  const { actors, hostel } = setup();
  const student = createStudent(actors, 'E-1', { pay: 50000 });
  allocationService.autoAllocate(student.id, actors.warden);
  assert.equal(hostelService.listFreeBeds({ hostelId: hostel.id }).length, 1);

  assert.throws(
    () => stayService.checkOut(student.id, actors.warden),
    (error) => error.code === 'CONFLICT',
  );

  const cancelled = stayService.checkOut(student.id, actors.warden, { cancelIfAssigned: true });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(hostelService.listFreeBeds({ hostelId: hostel.id }).length, 2);
});

test('check-in refuses a student whose deposit is incomplete', () => {
  const { actors } = setup();
  const student = createStudent(actors, 'OC-1', { pay: 50000 });
  allocationService.autoAllocate(student.id, actors.warden);

  const firstPaymentId = getDb()
    .prepare('SELECT id FROM fee_payments WHERE student_id = ? ORDER BY id LIMIT 1')
    .get(student.id).id;
  getDb().prepare('UPDATE fee_payments SET amount = 1000 WHERE id = ?').run(firstPaymentId);

  assert.throws(
    () => stayService.checkIn(student.id, actors.warden),
    (error) => error.code === 'NOT_ELIGIBLE',
  );

  const overridden = stayService.checkIn(student.id, actors.warden, { allowIneligible: true });
  assert.equal(overridden.status, 'checked_in');
});
