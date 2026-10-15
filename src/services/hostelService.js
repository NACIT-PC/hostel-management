/**
 * Hostel inventory: hostels, rooms and beds.
 *
 * Hostels keep denormalised `total_rooms` / `total_beds` counters that are
 * always recalculated from the actual rooms/beds inside the same transaction,
 * so the inventory can never silently drift.
 */
import { getDb, transact } from '../db/connection.js';
import {
  HOSTEL_GENDERS,
  HOSTEL_CATEGORIES,
  ALL_YEARS,
  ROOM_AMENITIES,
  BUNK_LEVELS,
  LIMITS,
} from '../config.js';
import { assertPermission, PERMISSIONS } from '../security/permissions.js';
import { log as auditLog } from './auditService.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { asText, asInteger, asOneOf, asBoolean, asAmenities } from '../utils/validate.js';

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function listHostels({ includeEmpty = true } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT h.id, h.name, h.gender, h.category, h.total_rooms, h.total_beds, h.description,
              COALESCE(o.total_rooms, 0)                        AS actual_rooms,
              COALESCE(o.total_beds, 0)                         AS actual_beds,
              COALESCE(o.occupied_beds, 0)                      AS occupied_beds,
              COALESCE(o.checked_in_beds, 0)                    AS checked_in_beds,
              COALESCE(o.reserved_beds, 0)                      AS reserved_beds,
              COALESCE(o.free_beds, 0)                          AS free_beds
         FROM hostels h
         LEFT JOIN v_hostel_occupancy o ON o.hostel_id = h.id
        ORDER BY h.name COLLATE NOCASE`,
    )
    .all();
  return includeEmpty ? rows : rows.filter((row) => row.actual_beds > 0);
}

export function getHostel(identifier) {
  if (identifier === undefined || identifier === null || identifier === '') {
    throw new ValidationError('Hostel identifier is required.');
  }
  const db = getDb();
  const raw = String(identifier).trim();
  let row = null;
  if (/^\d+$/.test(raw)) {
    row = db.prepare('SELECT * FROM hostels WHERE id = ?').get(Number(raw));
  }
  if (!row) {
    row = db
      .prepare('SELECT * FROM hostels WHERE name = ? COLLATE NOCASE')
      .get(raw);
  }
  if (!row) throw new NotFoundError(`Hostel "${raw}" was not found.`);
  return row;
}

export function getHostelById(id) {
  return getDb().prepare('SELECT * FROM hostels WHERE id = ?').get(Number(id));
}

export function describeCategory(category) {
  return category === ALL_YEARS ? 'all years/forms' : category;
}

export function hostelRuleText(hostel) {
  const gender = hostel.gender === 'Mixed' ? 'Mixed gender' : `${hostel.gender} only`;
  return `${gender}, ${describeCategory(hostel.category)}`;
}

/* ------------------------------------------------------------------ */
/* Rooms and beds                                                      */
/* ------------------------------------------------------------------ */

export function listRooms(hostelId, { includeUnavailable = true } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.hostel_id, r.room_number, r.floor, r.capacity, r.amenities, r.is_available,
              COUNT(b.id)                                            AS bed_count,
              COALESCE(SUM(CASE WHEN o.is_occupied = 1 THEN 1 ELSE 0 END), 0) AS occupied_beds
         FROM rooms r
         LEFT JOIN beds b ON b.room_id = r.id
         LEFT JOIN v_bed_occupancy o ON o.bed_id = b.id
        WHERE r.hostel_id = ?
        GROUP BY r.id
        ORDER BY r.floor, CAST(r.room_number AS INTEGER), r.room_number COLLATE NOCASE`,
    )
    .all(Number(hostelId));
  return includeUnavailable ? rows : rows.filter((row) => row.is_available === 1);
}

export function getRoom(identifier, hostelId = null) {
  const db = getDb();
  const raw = String(identifier ?? '').trim();
  if (!raw) throw new ValidationError('Room identifier is required.');

  if (/^\d+$/.test(raw)) {
    const byId = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(raw));
    if (byId && (!hostelId || byId.hostel_id === Number(hostelId))) return byId;
  }
  if (hostelId) {
    const byNumber = db
      .prepare('SELECT * FROM rooms WHERE hostel_id = ? AND room_number = ? COLLATE NOCASE')
      .get(Number(hostelId), raw);
    if (byNumber) return byNumber;
  }
  throw new NotFoundError(
    hostelId ? `Room "${raw}" was not found in the selected hostel.` : `Room "${raw}" was not found.`,
  );
}

export function listBedsInRoom(roomId) {
  return getDb()
    .prepare(
      `SELECT o.bed_id AS id, o.bed_label AS label, o.bunk_level, o.bed_enabled AS is_available,
              o.is_occupied, o.student_code, o.student_name, o.allocation_status
         FROM v_bed_occupancy o
        WHERE o.room_id = ?
        ORDER BY o.bed_label COLLATE NOCASE`,
    )
    .all(Number(roomId));
}

export function listBeds(hostelId) {
  return getDb()
    .prepare(
      `SELECT * FROM v_bed_occupancy WHERE hostel_id = ? ORDER BY room_number, bed_label`,
    )
    .all(Number(hostelId));
}

export function getBed(bedId) {
  const row = getDb().prepare('SELECT * FROM v_bed_occupancy WHERE bed_id = ?').get(Number(bedId));
  if (!row) throw new NotFoundError(`Bed #${bedId} was not found.`);
  return row;
}

/** Free (unoccupied, enabled) beds, optionally filtered. */
export function listFreeBeds({ hostelId = null } = {}) {
  const conditions = ['is_occupied = 0', 'bed_enabled = 1', 'room_enabled = 1'];
  const params = [];
  if (hostelId) {
    conditions.push('hostel_id = ?');
    params.push(Number(hostelId));
  }
  return getDb()
    .prepare(
      `SELECT * FROM v_bed_occupancy WHERE ${conditions.join(' AND ')}
        ORDER BY hostel_name COLLATE NOCASE, room_number, bed_label`,
    )
    .all(...params);
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/** Distribute `totalBeds` beds across `totalRooms` rooms as evenly as possible. */
export function distributeBeds(totalBeds, totalRooms) {
  const base = Math.floor(totalBeds / totalRooms);
  const remainder = totalBeds % totalRooms;
  return Array.from({ length: totalRooms }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** Bed layout for a room of a given capacity: bunk pairs then single beds. */
export function bedLayout(capacity) {
  if (capacity <= 1) return [{ label: 'B1', bunkLevel: 'SINGLE' }];
  const layout = [
    { label: 'B1', bunkLevel: 'LOWER' },
    { label: 'B2', bunkLevel: 'UPPER' },
  ];
  for (let index = 3; index <= capacity; index += 1) {
    layout.push({ label: `B${index}`, bunkLevel: 'SINGLE' });
  }
  return layout;
}

function insertBeds(roomId, capacity, explicitLayout = null) {
  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO beds (room_id, label, bunk_level) VALUES (?, ?, ?)',
  );
  const layout = explicitLayout ?? bedLayout(capacity);
  for (const bed of layout) {
    insert.run(roomId, bed.label, bed.bunkLevel);
  }
}

function syncHostelCounts(hostelId) {
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT COUNT(DISTINCT r.id) AS rooms, COUNT(b.id) AS beds
         FROM rooms r
         LEFT JOIN beds b ON b.room_id = r.id
        WHERE r.hostel_id = ?`,
    )
    .get(Number(hostelId));
  db.prepare(
    "UPDATE hostels SET total_rooms = ?, total_beds = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(counts.rooms, counts.beds, Number(hostelId));
  return counts;
}

/**
 * Register a hostel and generate its room/bed inventory.
 *
 * @param {{name:string, gender:string, category?:string, totalRooms:number,
 *          totalBeds:number, roomsPerFloor?:number, description?:string}} input
 */
export function createHostel(input, actor) {
  assertPermission(actor, PERMISSIONS.HOSTEL_MANAGE);

  const name = asText(input.name, 'Hostel name', { max: 80 });
  const gender = asOneOf(input.gender, HOSTEL_GENDERS, 'Hostel gender');
  const category = asOneOf(input.category ?? ALL_YEARS, HOSTEL_CATEGORIES, 'Hostel category');
  const totalRooms = asInteger(input.totalRooms, 'Number of rooms', {
    min: 1,
    max: LIMITS.MAX_ROOMS_PER_HOSTEL,
  });
  const totalBeds = asInteger(input.totalBeds, 'Number of beds', {
    min: totalRooms,
    max: totalRooms * LIMITS.MAX_BEDS_PER_ROOM,
  });
  const roomsPerFloor = asInteger(input.roomsPerFloor ?? LIMITS.DEFAULT_ROOMS_PER_FLOOR, 'Rooms per floor', {
    min: 1,
    max: LIMITS.MAX_ROOMS_PER_HOSTEL,
  });
  const description = input.description ? asText(input.description, 'Description', { max: 400 }) : null;

  const db = getDb();
  const existing = db.prepare('SELECT id FROM hostels WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) throw new ConflictError(`A hostel named "${name}" already exists.`);

  return transact(() => {
    const info = db
      .prepare(
        `INSERT INTO hostels (name, gender, category, total_rooms, total_beds, description, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, gender, category, totalRooms, totalBeds, description, actor?.id ?? null);

    const hostelId = Number(info.lastInsertRowid);
    const distribution = distributeBeds(totalBeds, totalRooms);
    const insertRoom = db.prepare(
      'INSERT INTO rooms (hostel_id, room_number, floor, capacity, amenities) VALUES (?, ?, ?, ?, ?)',
    );

    distribution.forEach((capacity, index) => {
      const floor = Math.floor(index / roomsPerFloor);
      const roomInfo = insertRoom.run(hostelId, String(index + 1), floor, capacity, '');
      insertBeds(Number(roomInfo.lastInsertRowid), capacity);
    });

    syncHostelCounts(hostelId);

    auditLog({
      actor,
      action: 'hostel.created',
      entity: 'hostels',
      entityId: hostelId,
      detail: `${name} | ${gender} | ${category} | ${totalRooms} rooms / ${totalBeds} beds`,
    });

    return getHostelById(hostelId);
  });
}

export function updateHostelFields(identifier, changes, actor) {
  assertPermission(actor, PERMISSIONS.HOSTEL_MANAGE);
  const hostel = getHostel(identifier);
  const db = getDb();

  const updates = [];
  const params = [];

  if (changes.name !== undefined) {
    const name = asText(changes.name, 'Hostel name', { max: 80 });
    const clash = db
      .prepare('SELECT id FROM hostels WHERE name = ? COLLATE NOCASE AND id <> ?')
      .get(name, hostel.id);
    if (clash) throw new ConflictError(`A hostel named "${name}" already exists.`);
    updates.push('name = ?');
    params.push(name);
  }
  if (changes.gender !== undefined) {
    updates.push('gender = ?');
    params.push(asOneOf(changes.gender, HOSTEL_GENDERS, 'Hostel gender'));
  }
  if (changes.category !== undefined) {
    updates.push('category = ?');
    params.push(asOneOf(changes.category, HOSTEL_CATEGORIES, 'Hostel category'));
  }
  if (changes.description !== undefined) {
    updates.push('description = ?');
    params.push(changes.description ? asText(changes.description, 'Description', { max: 400 }) : null);
  }

  if (!updates.length) throw new ValidationError('Nothing to update.');

  db.prepare(
    `UPDATE hostels SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...params, hostel.id);

  auditLog({
    actor,
    action: 'hostel.updated',
    entity: 'hostels',
    entityId: hostel.id,
    detail: JSON.stringify(changes),
  });
  return getHostelById(hostel.id);
}

export function addRoom({ hostelId, roomNumber, floor, capacity, amenities }, actor) {
  assertPermission(actor, PERMISSIONS.ROOM_MANAGE);
  const hostel = getHostel(hostelId);
  const cleanNumber = asText(roomNumber, 'Room number', { max: 20 });
  const cleanFloor = asInteger(floor ?? 0, 'Floor', { min: 0, max: 100 });
  const cleanCapacity = asInteger(capacity, 'Capacity', { min: 1, max: LIMITS.MAX_BEDS_PER_ROOM });
  const cleanAmenities = asAmenities(amenities, ROOM_AMENITIES);

  const db = getDb();
  const clash = db
    .prepare('SELECT id FROM rooms WHERE hostel_id = ? AND room_number = ? COLLATE NOCASE')
    .get(hostel.id, cleanNumber);
  if (clash) throw new ConflictError(`Room "${cleanNumber}" already exists in ${hostel.name}.`);

  return transact(() => {
    const info = db
      .prepare('INSERT INTO rooms (hostel_id, room_number, floor, capacity, amenities) VALUES (?, ?, ?, ?, ?)')
      .run(hostel.id, cleanNumber, cleanFloor, cleanCapacity, cleanAmenities);
    const roomId = Number(info.lastInsertRowid);
    insertBeds(roomId, cleanCapacity);
    syncHostelCounts(hostel.id);
    auditLog({
      actor,
      action: 'room.created',
      entity: 'rooms',
      entityId: roomId,
      detail: `${hostel.name} / ${cleanNumber} (capacity ${cleanCapacity})`,
    });
    return getRoom(roomId);
  });
}

export function updateRoomAmenities(roomId, amenities, actor) {
  assertPermission(actor, PERMISSIONS.ROOM_MANAGE);
  const room = getRoom(roomId);
  const clean = asAmenities(amenities, ROOM_AMENITIES);
  getDb()
    .prepare('UPDATE rooms SET amenities = ? WHERE id = ?')
    .run(clean, room.id);
  auditLog({ actor, action: 'room.amenities_updated', entity: 'rooms', entityId: room.id, detail: clean });
  return getRoom(room.id);
}

export function setRoomAvailability(roomId, available, actor) {
  assertPermission(actor, PERMISSIONS.ROOM_MANAGE);
  const room = getRoom(roomId);
  const flag = asBoolean(available, 'Availability');
  const db = getDb();

  if (!flag) {
    const occupied = db
      .prepare("SELECT COUNT(*) AS count FROM allocations WHERE bed_id IN (SELECT id FROM beds WHERE room_id = ?) AND status IN ('assigned','checked_in')")
      .get(room.id).count;
    if (occupied > 0) {
      throw new ConflictError(
        `Room ${room.room_number} still has ${occupied} active allocation(s). Check students out or cancel first.`,
      );
    }
  }

  db.prepare('UPDATE rooms SET is_available = ? WHERE id = ?').run(flag ? 1 : 0, room.id);
  auditLog({
    actor,
    action: flag ? 'room.enabled' : 'room.disabled',
    entity: 'rooms',
    entityId: room.id,
  });
  return getRoom(room.id);
}

export function addBed({ roomId, label, bunkLevel = 'SINGLE' }, actor) {
  assertPermission(actor, PERMISSIONS.ROOM_MANAGE);
  const room = getRoom(roomId);
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) AS count FROM beds WHERE room_id = ?').get(room.id).count;
  if (existing >= LIMITS.MAX_BEDS_PER_ROOM) {
    throw new ValidationError(`Room ${room.room_number} already has the maximum of ${LIMITS.MAX_BEDS_PER_ROOM} beds.`);
  }
  const cleanLabel = label ? asText(label, 'Bed label', { max: 12 }) : `B${existing + 1}`;
  const cleanBunk = asOneOf(bunkLevel, BUNK_LEVELS, 'Bunk level');

  try {
    const info = db
      .prepare('INSERT INTO beds (room_id, label, bunk_level) VALUES (?, ?, ?)')
      .run(room.id, cleanLabel, cleanBunk);
    db.prepare('UPDATE rooms SET capacity = capacity + 1 WHERE id = ?').run(room.id);
    syncHostelCounts(room.hostel_id);
    auditLog({
      actor,
      action: 'bed.created',
      entity: 'beds',
      entityId: Number(info.lastInsertRowid),
      detail: `room ${room.room_number} / ${cleanLabel}`,
    });
    return getBed(Number(info.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw new ConflictError(`Bed "${cleanLabel}" already exists in room ${room.room_number}.`);
    }
    throw error;
  }
}

export function removeBed(bedId, actor) {
  assertPermission(actor, PERMISSIONS.ROOM_MANAGE);
  const bed = getBed(bedId);
  const db = getDb();

  const active = db
    .prepare("SELECT COUNT(*) AS count FROM allocations WHERE bed_id = ? AND status IN ('assigned','checked_in')")
    .get(bed.bed_id).count;
  if (active > 0) throw new ConflictError(`Bed ${bed.hostel_name}/${bed.room_number}/${bed.bed_label} is occupied.`);

  const history = db.prepare('SELECT COUNT(*) AS count FROM allocations WHERE bed_id = ?').get(bed.bed_id).count;
  if (history > 0) {
    throw new ConflictError(
      'This bed has allocation history and cannot be deleted (it would break the audit trail). Disable it instead.',
    );
  }

  transact(() => {
    db.prepare('DELETE FROM beds WHERE id = ?').run(bed.bed_id);
    db.prepare('UPDATE rooms SET capacity = MAX(capacity - 1, 0) WHERE id = ?').run(bed.room_id);
    syncHostelCounts(bed.hostel_id);
  });

  auditLog({
    actor,
    action: 'bed.deleted',
    entity: 'beds',
    entityId: bed.bed_id,
    detail: `${bed.hostel_name}/${bed.room_number}/${bed.bed_label}`,
  });
  return true;
}

export function setBedAvailability(bedId, available, actor) {
  assertPermission(actor, PERMISSIONS.ROOM_MANAGE);
  const bed = getBed(bedId);
  const flag = asBoolean(available, 'Availability');
  if (!flag && bed.is_occupied) {
    throw new ConflictError(`Bed ${bed.room_number}/${bed.bed_label} is currently occupied.`);
  }
  getDb().prepare('UPDATE beds SET is_available = ? WHERE id = ?').run(flag ? 1 : 0, bed.bed_id);
  auditLog({
    actor,
    action: flag ? 'bed.enabled' : 'bed.disabled',
    entity: 'beds',
    entityId: bed.bed_id,
  });
  return getBed(bed.bed_id);
}

export function removeRoom(roomId, actor) {
  assertPermission(actor, PERMISSIONS.ROOM_MANAGE);
  const room = getRoom(roomId);
  const db = getDb();

  const active = db
    .prepare("SELECT COUNT(*) AS count FROM allocations WHERE bed_id IN (SELECT id FROM beds WHERE room_id = ?) AND status IN ('assigned','checked_in')")
    .get(room.id).count;
  if (active > 0) throw new ConflictError(`Room ${room.room_number} has ${active} active allocation(s).`);

  const history = db
    .prepare('SELECT COUNT(*) AS count FROM allocations WHERE bed_id IN (SELECT id FROM beds WHERE room_id = ?)')
    .get(room.id).count;
  if (history > 0) {
    throw new ConflictError('This room has allocation history and cannot be deleted. Disable it instead.');
  }

  transact(() => {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
    syncHostelCounts(room.hostel_id);
  });

  auditLog({ actor, action: 'room.deleted', entity: 'rooms', entityId: room.id, detail: room.room_number });
  return true;
}

/** Compare stored counters with reality - used by the inventory report. */
export function verifyInventory() {
  return getDb()
    .prepare(
      `SELECT h.id, h.name, h.total_rooms AS declared_rooms, h.total_beds AS declared_beds,
              COALESCE(o.total_rooms, 0) AS actual_rooms, COALESCE(o.total_beds, 0) AS actual_beds
         FROM hostels h
         LEFT JOIN v_hostel_occupancy o ON o.hostel_id = h.id
        ORDER BY h.name COLLATE NOCASE`,
    )
    .all()
    .map((row) => ({
      ...row,
      consistent: row.declared_rooms === row.actual_rooms && row.declared_beds === row.actual_beds,
    }));
}
