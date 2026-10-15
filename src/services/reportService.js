/**
 * Availability and documentational reporting queries.
 *
 * These wrap the SQL views so the CLI only prints, never computes.
 */
import { getDb } from '../db/connection.js';
import { listHostels, getHostel, verifyInventory } from './hostelService.js';
import { feeStatusReport } from './feeService.js';
import { currentResidents as residents } from './stayService.js';
import { getCurrency, getFirstDepositRequirement, getInstitutionName } from './settingsService.js';

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

/** Real-time availability for one hostel or every hostel. */
export function availability({ hostelIdentifier = null } = {}) {
  const hostels = hostelIdentifier ? [getHostel(hostelIdentifier)] : listHostels();
  const db = getDb();
  const rowFor = db.prepare(
    `SELECT total_rooms, total_beds, occupied_beds, reserved_beds, checked_in_beds, free_beds
       FROM v_hostel_occupancy WHERE hostel_id = ?`,
  );

  return hostels.map((hostel) => {
    const counts = rowFor.get(hostel.id) ?? {
      total_rooms: 0,
      total_beds: 0,
      occupied_beds: 0,
      reserved_beds: 0,
      checked_in_beds: 0,
      free_beds: 0,
    };
    return {
      hostel,
      ...counts,
      usableBeds: Number(counts.free_beds),
      utilisation: Number(counts.total_beds) > 0
        ? Math.round((Number(counts.occupied_beds) / Number(counts.total_beds)) * 1000) / 10
        : 0,
    };
  });
}

/** Room-level availability (optionally only rooms with free beds). */
export function roomAvailability({ hostelIdentifier = null, onlyFree = false } = {}) {
  const conditions = [];
  const params = [];
  if (hostelIdentifier) {
    const hostel = getHostel(hostelIdentifier);
    conditions.push('o.hostel_id = ?');
    params.push(hostel.id);
  }
  if (onlyFree) conditions.push('o.free_beds > 0');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb()
    .prepare(
      `SELECT o.room_id, o.room_number, o.floor, o.capacity, o.amenities, o.room_enabled,
              o.total_beds, o.occupied_beds, o.free_beds,
              o.hostel_id, o.hostel_name, o.hostel_gender
         FROM v_room_occupancy o
         ${where}
        ORDER BY o.hostel_name COLLATE NOCASE, CAST(o.room_number AS INTEGER), o.room_number`,
    )
    .all(...params);
}

/** Free beds with the full physical description (used by the allocator UI). */
export function freeBedList({ hostelIdentifier = null } = {}) {
  const conditions = ['o.is_occupied = 0', 'o.bed_enabled = 1', 'o.room_enabled = 1'];
  const params = [];
  if (hostelIdentifier) {
    const hostel = getHostel(hostelIdentifier);
    conditions.push('o.hostel_id = ?');
    params.push(hostel.id);
  }
  return getDb()
    .prepare(
      `SELECT o.* FROM v_bed_occupancy o
        WHERE ${conditions.join(' AND ')}
        ORDER BY o.hostel_name COLLATE NOCASE, CAST(o.room_number AS INTEGER), o.bed_label`,
    )
    .all(...params);
}

/** Which student occupies which room - the classic documentational query. */
export function studentsByRoom({ hostelIdentifier = null } = {}) {
  const conditions = ["o.is_occupied = 1"];
  const params = [];
  if (hostelIdentifier) {
    const hostel = getHostel(hostelIdentifier);
    conditions.push('o.hostel_id = ?');
    params.push(hostel.id);
  }
  return getDb()
    .prepare(
      `SELECT o.hostel_name, o.room_number, o.bed_label, o.bunk_level, o.student_code, o.student_name,
              o.student_gender, o.student_year_form, o.allocation_status, o.checked_in_at
         FROM v_bed_occupancy o
        WHERE ${conditions.join(' AND ')}
        ORDER BY o.hostel_name COLLATE NOCASE, CAST(o.room_number AS INTEGER), o.bed_label`,
    )
    .all(...params);
}

/* ------------------------------------------------------------------ */
/* Occupancy & students                                                */
/* ------------------------------------------------------------------ */

export function occupancyByHostel() {
  return getDb()
    .prepare(
      `SELECT o.*, 
              CASE WHEN o.total_beds > 0 THEN ROUND(o.occupied_beds * 100.0 / o.total_beds, 1) ELSE 0 END AS utilisation
         FROM v_hostel_occupancy o
        ORDER BY o.hostel_name COLLATE NOCASE`,
    )
    .all();
}

export function occupancyByRoom({ hostelIdentifier = null } = {}) {
  return roomAvailability({ hostelIdentifier });
}

export function currentResidentsReport({ hostelIdentifier = null, assignedOnly = false } = {}) {
  const hostel = hostelIdentifier ? getHostel(hostelIdentifier) : null;
  return residents({ hostelId: hostel?.id ?? null, assignedOnly });
}

/** Students registered but with no active bed. */
export function unallocatedStudents() {
  return getDb()
    .prepare(
      `SELECT s.id, s.student_code, s.full_name, s.gender, s.year_form, s.phone,
              COALESCE(f.total_paid, 0) AS total_paid,
              COALESCE(f.payment_count, 0) AS payment_count
         FROM students s
         LEFT JOIN v_student_fees f ON f.student_id = s.id
        WHERE s.is_active = 1
          AND NOT EXISTS (
            SELECT 1 FROM allocations a
             WHERE a.student_id = s.id AND a.status IN ('assigned', 'checked_in')
          )
        ORDER BY s.full_name COLLATE NOCASE`,
    )
    .all()
    .map((row) => {
      const required = getFirstDepositRequirement();
      return {
        ...row,
        total_paid: Number(row.total_paid),
        required,
        feeOk: Number(row.total_paid) >= required,
      };
    });
}

export function feeReport({ onlyShortfall = false } = {}) {
  return feeStatusReport({ onlyShortfall });
}

export function inventoryReport() {
  return verifyInventory();
}

/** Counts used on the dashboard. */
export function dashboard() {
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM hostels)                                   AS hostels,
         (SELECT COUNT(*) FROM rooms)                                     AS rooms,
         (SELECT COUNT(*) FROM beds)                                      AS beds,
         (SELECT COUNT(*) FROM students WHERE is_active = 1)              AS students,
         (SELECT COUNT(*) FROM allocations WHERE status = 'assigned')     AS assigned,
         (SELECT COUNT(*) FROM allocations WHERE status = 'checked_in')   AS checked_in,
         (SELECT COALESCE(SUM(amount), 0) FROM fee_payments)              AS fees_collected,
         (SELECT COUNT(*) FROM users WHERE active = 1)                     AS users`,
    )
    .get();

  const occupied = Number(counts.assigned) + Number(counts.checked_in);
  return {
    institution: getInstitutionName(),
    currency: getCurrency(),
    firstDepositRequirement: getFirstDepositRequirement(),
    ...counts,
    occupied,
    freeBeds: Number(counts.beds) - occupied,
    utilisation: Number(counts.beds) > 0 ? Math.round((occupied / Number(counts.beds)) * 1000) / 10 : 0,
  };
}

/**
 * Health/sensitivity accommodation overview WITHOUT revealing private text:
 * only the codes, levels and where those students are placed.
 */
export function specialNeedsOverview({ hostelIdentifier = null } = {}) {
  const conditions = [];
  const params = [];
  if (hostelIdentifier) {
    const hostel = getHostel(hostelIdentifier);
    conditions.push('h.id = ?');
    params.push(hostel.id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const withConditions = getDb()
    .prepare(
      `SELECT s.student_code, s.full_name, s.gender, s.year_form,
              c.code, c.level,
              h.name AS hostel_name, r.room_number, b.label AS bed_label, a.status AS allocation_status,
              CASE WHEN s.health_notes IS NOT NULL AND TRIM(s.health_notes) <> '' THEN 1 ELSE 0 END AS has_private_notes
         FROM student_health_conditions c
         JOIN students s ON s.id = c.student_id
         LEFT JOIN allocations a ON a.student_id = s.id AND a.status IN ('assigned', 'checked_in')
         LEFT JOIN beds b  ON b.id = a.bed_id
         LEFT JOIN rooms r ON r.id = b.room_id
         LEFT JOIN hostels h ON h.id = r.hostel_id
         ${where}
        ORDER BY s.full_name COLLATE NOCASE, c.level, c.code`,
    )
    .all(...params);

  const notesOnly = getDb()
    .prepare(
      `SELECT s.student_code, s.full_name, s.gender, s.year_form,
              h.name AS hostel_name, r.room_number, b.label AS bed_label, a.status AS allocation_status
         FROM students s
         LEFT JOIN allocations a ON a.student_id = s.id AND a.status IN ('assigned', 'checked_in')
         LEFT JOIN beds b  ON b.id = a.bed_id
         LEFT JOIN rooms r ON r.id = b.room_id
         LEFT JOIN hostels h ON h.id = r.hostel_id
        WHERE s.health_notes IS NOT NULL AND TRIM(s.health_notes) <> ''
          AND NOT EXISTS (SELECT 1 FROM student_health_conditions c WHERE c.student_id = s.id)
        ORDER BY s.full_name COLLATE NOCASE`,
    )
    .all();

  return { withConditions, notesOnly };
}
