import { getDb, transact } from '../db/connection.js';
import { assertPermission, PERMISSIONS } from '../security/permissions.js';
import { log as auditLog } from './auditService.js';
import { resolveStudent, getStudentSummaryRow } from './studentService.js';
import { getFeeSummary } from './feeService.js';
import { getActiveAllocation, getAllocationById } from './allocationService.js';
import { ConflictError, EligibilityError, NotFoundError, ValidationError } from '../utils/errors.js';
import { money as formatMoney } from '../utils/format.js';

function recordStay({ allocation, action, actor, note = null }) {
  getDb()
    .prepare(
      'INSERT INTO stay_logs (allocation_id, student_id, bed_id, action, actor_id, note) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(allocation.id, allocation.student_id, allocation.bed_id, action, actor?.id ?? null, note);
}

export function checkIn(identifier, actor, { allowIneligible = false, note = null } = {}) {
  assertPermission(actor, PERMISSIONS.STAY_MANAGE);

  const allocation = resolveAllocation(identifier);
  if (allocation.status === 'checked_in') {
    throw new ConflictError(
      `${allocation.student_code} is already checked in (${allocation.hostel_name} ${allocation.room_number}/${allocation.bed_label}).`,
    );
  }
  if (allocation.status !== 'assigned') {
    throw new ConflictError(`Allocation #${allocation.id} is ${allocation.status}; only assigned beds can be checked in.`);
  }

  const summary = getStudentSummaryRow(allocation.student_id);
  if (summary?.is_active !== 1) throw new ValidationError('Student record is inactive.');

  const fee = getFeeSummary(allocation.student_id);
  if (!fee.meetsRequirement && !allowIneligible) {
    throw new EligibilityError(
      `Fee deposit incomplete: ${formatMoney(fee.total_paid, fee.currency)} of ${formatMoney(
        fee.required,
        fee.currency,
      )}. Collect the deposit or use the zomwe mukufuna override.`,
    );
  }

  return transact(() => {
    getDb()
      .prepare("UPDATE allocations SET status = 'checked_in', checked_in_at = datetime('now') WHERE id = ?")
      .run(allocation.id);
    recordStay({
      allocation,
      action: 'checked_in',
      actor,
      note: allowIneligible && !fee.meetsRequirement ? `override: ${note ?? 'eligibility override'}` : note,
    });
    auditLog({
      actor,
      action: 'stay.checked_in',
      entity: 'allocations',
      entityId: allocation.id,
      detail: `${allocation.student_code} | ${allocation.hostel_name} ${allocation.room_number}/${allocation.bed_label}${
        allowIneligible && !fee.meetsRequirement ? ' | OVERRIDE (fee incomplete)' : ''
      }`,
    });
    return getAllocationById(allocation.id);
  });
}

export function checkOut(identifier, actor, { note = null, cancelIfAssigned = false } = {}) {
  assertPermission(actor, PERMISSIONS.STAY_MANAGE);
  const allocation = resolveAllocation(identifier);

  if (allocation.status === 'checked_out' || allocation.status === 'cancelled') {
    throw new ConflictError(`Allocation #${allocation.id} is already ${allocation.status}.`);
  }

  if (allocation.status === 'assigned' && !cancelIfAssigned) {
    throw new ConflictError(
      `${allocation.student_code} was never checked in. Cancel the assignment instead (or choose "cancel" to release the bed).`,
    );
  }

  const nextStatus = allocation.status === 'assigned' ? 'cancelled' : 'checked_out';
  const action = nextStatus === 'cancelled' ? 'cancelled' : 'checked_out';

  return transact(() => {
    if (nextStatus === 'checked_out') {
      getDb()
        .prepare("UPDATE allocations SET status = 'checked_out', checked_out_at = datetime('now') WHERE id = ?")
        .run(allocation.id);
    } else {
      getDb()
        .prepare("UPDATE allocations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?")
        .run(allocation.id);
    }

    recordStay({ allocation, action, actor, note });
    auditLog({
      actor,
      action: `stay.${action}`,
      entity: 'allocations',
      entityId: allocation.id,
      detail: `${allocation.student_code} | ${allocation.hostel_name} ${allocation.room_number}/${allocation.bed_label}${
        note ? ` | ${note}` : ''
      }`,
    });
    return getAllocationById(allocation.id);
  });
}

function resolveAllocation(identifier) {
  if (identifier === undefined || identifier === null || String(identifier).trim() === '') {
    throw new ValidationError('Student or allocation identifier is required.');
  }
  const raw = String(identifier).trim();

  if (/^#?\d+$/.test(raw)) {
    const id = Number(raw.replace('#', ''));
    const byAllocationId = getAllocationById(id);
    if (byAllocationId) return byAllocationId;
    const student = resolveStudent(id);
    const active = getActiveAllocation(student.id);
    if (active) return getAllocationById(active.id);
    throw new NotFoundError(`${student.student_code} has no active allocation.`);
  }

  const student = resolveStudent(raw);
  const active = getActiveAllocation(student.id);
  if (!active) throw new NotFoundError(`${student.student_code} has no active allocation.`);
  return getAllocationById(active.id);
}

export function listStayLogs({ limit = 50, studentIdentifier = null, hostelId = null, action = null } = {}) {
  const conditions = [];
  const params = [];
  if (studentIdentifier) {
    const student = resolveStudent(studentIdentifier);
    conditions.push('l.student_id = ?');
    params.push(student.id);
  }
  if (hostelId) {
    conditions.push('h.id = ?');
    params.push(Number(hostelId));
  }
  if (action) {
    conditions.push('l.action = ?');
    params.push(action);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return getDb()
    .prepare(
      `SELECT l.id, l.action, l.at, l.note, s.student_code, s.full_name AS student_name,
              h.name AS hostel_name, r.room_number, b.label AS bed_label,
              COALESCE(u.username, 'system') AS actor
         FROM stay_logs l
         JOIN students s ON s.id = l.student_id
         JOIN beds b  ON b.id = l.bed_id
         JOIN rooms r ON r.id = b.room_id
         JOIN hostels h ON h.id = r.hostel_id
         LEFT JOIN users u ON u.id = l.actor_id
         ${where}
        ORDER BY l.id DESC
        LIMIT ?`,
    )
    .all(...params, Number(limit));
}

export function currentResidents({ hostelId = null, assignedOnly = false } = {}) {
  const conditions = [assignedOnly ? "a.status IN ('assigned','checked_in')" : "a.status = 'checked_in'"];
  const params = [];
  if (hostelId) {
    conditions.push('h.id = ?');
    params.push(Number(hostelId));
  }
  return getDb()
    .prepare(
      `SELECT a.id AS allocation_id, a.status, a.assigned_at, a.checked_in_at,
              s.student_code, s.full_name AS student_name, s.gender, s.year_form, s.phone,
              h.id AS hostel_id, h.name AS hostel_name, r.room_number, r.floor, b.label AS bed_label
         FROM allocations a
         JOIN students s ON s.id = a.student_id
         JOIN beds b  ON b.id = a.bed_id
         JOIN rooms r ON r.id = b.room_id
         JOIN hostels h ON h.id = r.hostel_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY h.name COLLATE NOCASE, r.room_number, b.label`,
    )
    .all(...params);
}

export function studentStayHistory(studentIdentifier) {
  const student = resolveStudent(studentIdentifier);
  return getDb()
    .prepare(
      `SELECT a.id, a.status, a.assigned_at, a.checked_in_at, a.checked_out_at, a.cancelled_at, a.notes,
              h.name AS hostel_name, r.room_number, b.label AS bed_label
         FROM allocations a
         JOIN beds b  ON b.id = a.bed_id
         JOIN rooms r ON r.id = b.room_id
         JOIN hostels h ON h.id = r.hostel_id
        WHERE a.student_id = ?
        ORDER BY a.id DESC`,
    )
    .all(student.id);
}
