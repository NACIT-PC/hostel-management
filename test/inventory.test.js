/**
 * Inventory: room/bed generation and occupancy consistency.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostelService, freshSetup, getDb } from './helpers.js';

test('distributeBeds spreads beds across rooms as evenly as possible', () => {
  assert.deepEqual(hostelService.distributeBeds(12, 4), [3, 3, 3, 3]);
  assert.deepEqual(hostelService.distributeBeds(10, 4), [3, 3, 2, 2]);
  assert.deepEqual(hostelService.distributeBeds(7, 3), [3, 2, 2]);
  assert.deepEqual(hostelService.distributeBeds(2, 3), [1, 1, 0]);
});

test('bedLayout uses bunk pairs, then single beds', () => {
  assert.deepEqual(hostelService.bedLayout(1), [{ label: 'B1', bunkLevel: 'SINGLE' }]);
  assert.deepEqual(hostelService.bedLayout(2), [
    { label: 'B1', bunkLevel: 'LOWER' },
    { label: 'B2', bunkLevel: 'UPPER' },
  ]);
  assert.deepEqual(hostelService.bedLayout(4), [
    { label: 'B1', bunkLevel: 'LOWER' },
    { label: 'B2', bunkLevel: 'UPPER' },
    { label: 'B3', bunkLevel: 'SINGLE' },
    { label: 'B4', bunkLevel: 'SINGLE' },
  ]);
});

test('createHostel generates rooms, beds and consistent counters', () => {
  const { admin } = freshSetup();

  const hostel = hostelService.createHostel(
    {
      name: 'Test Hall',
      gender: 'Male',
      category: 'ALL',
      totalRooms: 4,
      totalBeds: 10,
      roomsPerFloor: 2,
      description: 'Generated inventory',
    },
    admin,
  );

  const rooms = hostelService.listRooms(hostel.id);
  assert.equal(rooms.length, 4);
  // 10 beds across 4 rooms -> 3, 3, 2, 2
  assert.deepEqual(
    rooms.map((room) => room.capacity),
    [3, 3, 2, 2],
  );
  assert.equal(rooms[0].floor, 0);
  assert.equal(rooms[2].floor, 1); // 2 rooms per floor

  const beds = hostelService.listBeds(hostel.id);
  assert.equal(beds.length, 10);
  assert.equal(hostelService.listFreeBeds({ hostelId: hostel.id }).length, 10);

  const reloaded = hostelService.getHostel(hostel.id);
  assert.equal(hostel.total_rooms, rooms.length);
  assert.equal(hostel.total_beds, beds.length);

  const consistency = hostelService.verifyInventory().find((row) => row.id === hostel.id);
  assert.equal(consistency.consistent, true);
  assert.equal(hostel.total_rooms, hostel.total_rooms);
  assert.equal(hostel.total_beds, 10);
});

test('addRoom creates beds with the correct bunk layout', () => {
  const { admin } = freshSetup();
  const hostel = hostelService.createHostel(
    { name: 'Bunk Hall', gender: 'Female', category: 'ALL', totalRooms: 1, totalBeds: 1 },
    admin,
  );

  const room = hostelService.addRoom(
    { hostelId: hostel.id, roomNumber: 'G1', floor: 0, capacity: 3, amenities: 'QUIET, FAN' },
    admin,
  );

  assert.equal(room.amenities, 'QUIET,FAN');
  const beds = hostelService.listBedsInRoom(room.id);
  assert.deepEqual(
    beds.map((bed) => [bed.label, bed.bunk_level]),
    [
      ['B1', 'LOWER'],
      ['B2', 'UPPER'],
      ['B3', 'SINGLE'],
    ],
  );
  // Enabling/disabling updates free-bed availability.
  hostelService.setBedAvailability(beds[0].id, false, admin);
  assert.equal(hostelService.listFreeBeds({ hostelId: hostel.id }).length, 3); // 1 (base room) + 3 - 1 disabled
});

test('foreign keys are enforced on every connection', () => {
  freshSetup();
  assert.equal(getDb().pragma('foreign_keys', { simple: true }), 1);
  assert.throws(
    () => getDb().prepare('INSERT INTO rooms (hostel_id, room_number, capacity) VALUES (?, ?, ?)').run(99999, 'X', 1),
    /FOREIGN KEY/i,
  );
});
