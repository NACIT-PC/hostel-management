/**
 * Bed allocation.
 *
 * Two entry points:
 *   autoAllocate()   - pick the best suitable bed automatically (used by the
 *                      "assign eligible student" flow and the CLI).
 *   allocateToBed()  - manual placement, still fully validated.
 *
 * Hard rules (never overridable): gender/year compatibility, fee eligibility,
 * required health conditions, bed free + enabled.
 * Soft rules (preferences): advisory health codes, room balance.
 */
import { getDb, transact } from '../db/connection.js';
import { assertPermission, PERMISSIONS } from '../security/permissions.js';
import { log as auditLog } from './auditService.js';
import { resolveStudent, getRequirements, getStudentSummaryRow } from './studentService.js';
import { listFreeBeds, getBed, getHostel } from './hostelService.js';
import { getFeeSummary } from './feeService.js';
import { hostelAcceptsStudent, evaluateBed, requirementSatisfied } from './matching.js';
import { getFirstDepositRequirement } from './settingsService.js';
import { ConflictError, EligibilityError, NotFoundError, ValidationError } from '../utils/errors.js';
import { money as formatMoney } from '../utils/format.js';

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function getActiveAllocation(studentId) {
  return getDb()
    .prepare(
      `SELECT a.*, b.label AS bed_label, r.room_number, r.floor, h.id AS hostel_id, h.name AS hostel_name
         FROM allocations a
         JOIN beds b  ON b.id = a.bed_id
         JOIN rooms r ON r.id = b.room_id
         JOIN hostels h ON h.id = r.hostel_id
        WHERE a.student_id = ? AND a.status IN ('assigned', 'checked_in')`,
    )
    .get(Number(studentId));
}

export function getAllocationById(id) {
  return getDb()
    .prepare(
      `SELECT a.*, b.label AS bed_label, r.room_number, h.id AS hostel_id, h.name AS hostel_name,
              s.student_code, s.full_name AS student_name
         FROM allocations a
         JOIN beds b  ON b.id = a.bed_id
         JOIN rooms r ON r.id = b.room_id
         JOIN hostels h ON h.id = r.hostel_id
         JOIN students s ON s.id = a.student_id
        WHERE a.id = ?`,
    )
    .get(Number(id));
}

export function listAllocations({ status = null, hostelId = null, studentIdentifier = null, limit = 200 } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    if (Array.isArray(status)) {
      conditions.push(`a.status IN (${status.map(() => '?').join(', ')})`);
      params.push(...status);
    } else {
      conditions.push('a.status = ?');
      params.push(status);
    }
  }
  if (hostelId) {
    conditions.push('h.id = ?');
    params.push(Number(hostelId));
  }
  if (studentIdentifier) {
    const student = resolveStudent(studentIdentifier);
    conditions.push('s.id = ?');
    params.push(student.id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb()
    .prepare(
      `SELECT a.id, a.status, a.assigned_at, a.checked_in_at, a.checked_out_at, a.cancelled_at, a.notes,
              s.student_code, s.full_name AS student_name, s.gender, s.year_form,
              h.name AS hostel_name, r.room_number, b.label AS bed_label
         FROM allocations a
         JOIN students s ON s.id = a.student_id
         JOIN beds b  ON b.id = a.bed_id
         JOIN rooms r ON r.id = b.room_id
         JOIN hostels h ON h.id = r.hostel_id
         ${where}
        ORDER BY a.id DESC
        LIMIT ?`,
    )
    .all(...params, Number(limit));
}

/**
 * Rank every free bed for a student.
 * @returns {{student: object, fee: object, candidates: Array<object>, rejected: Array<object>}}
 */
export function findCandidateBeds(studentIdentifier, { hostelIdentifier = null } = {}) {
  const student = resolveStudent(studentIdentifier);
  const fee = getFeeSummary(student.id);
  const requirements = getRequirements(student.id);
  const hostelFilter = hostelIdentifier ? getHostel(hostelIdentifier) : null;

  const hostels = getDb().prepare('SELECT * FROM hostels').all();
  const hostelById = new Map(hostels.map((hostel) => [hostel.id, hostel]));
  const freeBeds = listFreeBeds({ hostelId: hostelFilter?.id ?? null });

  const candidates = [];
  const rejected = [];

  for (const bed of freeBeds) {
    const hostel = hostelById.get(bed.hostel_id);
    const hostelRule = hostelAcceptsStudent(hostel, student);
    if (!hostelRule.ok) {
      rejected.push({ bed, reasons: hostelRule.reasons });
      continue;
    }

    const evaluation = evaluateBed(requirements, bed, bed);
    if (!evaluation.hardOk) {
      rejected.push({
        bed,
        reasons: evaluation.unmetRequired.map(
          (code) => `Required condition not met: ${code.replace(/_/g, ' ').toLowerCase()}.`,
        ),
      });
      continue;
    }

    candidates.push({ bed, hostel, evaluation });
  }

  return { student, fee, requirements, candidates, rejected, hostelFilter };
}

/* ------------------------------------------------------------------ */
/* Guarantees                                                          */
/* ------------------------------------------------------------------ */

function assertFeeEligible(studentId, { allowPartial = false } = {}) {
  const summary = getFeeSummary(studentId);
  if (summary.meetsRequirement) return summary;
  if (allowPartial) return summary;
  throw new EligibilityError(
    `Student has paid ${formatMoney(summary.total_paid, summary.currency)} of the required first deposit ${formatMoney(
      summary.required,
      summary.currency,
    )}. Record the deposit before allocating a bed.`,
    [`shortfall: ${(summary.required - summary.total_paid).toFixed(2)}`],
  );
}

function assertStudentFree(studentId) {
  const active = getActiveAllocation(studentId);
  const student = getStudentSummaryRow(studentId);
  if (active) {
    throw new ConflictError(
      `${student.student_code} already holds an active allocation (${active.hostel_name} ${active.room_number}/${active.bed_label}, status ${active.status}).`,
    );
  }
}

function assertStudentActive(studentId) {
  const student = getDb().prepare('SELECT is_active FROM students WHERE id = ?').get(Number(studentId));
  if (!student || student.is_active !== 1) {
    throw new ValidationError('This student record is inactive.');
  }
}

/** Checks a single bed for a single student; returns {ok, reasons}. */
export function validatePlacement(studentIdentifier, bedId) {
  const student = resolveStudent(studentIdentifier);
  const bed = getBed(bedId);
  const reasons = [];

  if (bed.is_occupied) reasons.push(`Bed ${bed.room_number}/${bed.bed_label} is already occupied.`);
  if (bed.bed_enabled !== 1) reasons.push(`Bed ${bed.bed_label} is disabled.`);
  if (bed.room_enabled !== 1) reasons.push(`Room ${bed.room_number} is disabled.`);

  const hostel = getHostel(bed.hostel_id);
  const hostelRule = hostelAcceptsStudent(hostel, student);
  reasons.push(...hostelRule.reasons);

  const fee = getFeeSummary(student.id);
  if (!fee.meetsRequirement) {
    reasons.push(
      `Fee deposit incomplete: ${formatMoney(fee.total_paid, fee.currency)} of ${formatMoney(
        fee.required || getFirstDepositRequirement(),
        fee.currency,
      )}.`,
    );
  }

  const requirements = getRequirements(student.id);
  const evaluation = evaluateBed(requirements, bed, bed);
  for (const code of evaluation.unmetRequired) {
    reasons.push(`Required health/sensitivity condition not satisfied: ${code.replace(/_/g, ' ').toLowerCase()}.`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    student,
    bed,
    hostel,
    fee,
    evaluation,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function insertAllocation({ studentId, bedId, actor, notes = null }) {
  const db = getDb();
  try {
    const info = db
      .prepare('INSERT INTO allocations (student_id, bed_id, status, assigned_by, notes) VALUES (?, ?, ?, ?, ?)')
      .run(studentId, bedId, 'assigned', actor?.id ?? null, notes);
    return Number(info.lastInsertRowid);
  } catch (error) {
    if (String(error.message).includes('ux_allocations')) {
      throw new ConflictError('That student or bed was just allocated by someone else. Reload and try again.');
    }
    throw error;
  }
}

/**
 * Automatically place an eligible student in the best available bed.
 *
 * Score order: preference matches desc, room occupancy asc (spread students),
 * floor asc (smaller room numbers first), hostel name.
 */
export function autoAllocate(studentIdentifier, actor, { hostelIdentifier = null, notes = null } = {}) {
  assertPermission(actor, PERMISSIONS.ALLOCATION_MANAGE);
  const student = resolveStudent(studentIdentifier);
  assertStudentActive(student.id);
  assertStudentFree(student.id);
  assertFeeEligible(student.id);

  const { candidates, rejected, hostelFilter } = findCandidateBeds(student.id, { hostelIdentifier });

  if (candidates.length === 0) {
    const detail = rejected.slice(0, 5).map(
      (entry) => `${entry.bed.hostel_name} ${entry.bed.room_number}/${entry.bed.bed_label}: ${entry.reasons.join(' ')}`,
    );
    throw new EligibilityError(
      hostelFilter
        ? `No suitable free bed in ${hostelFilter.name} for ${student.student_code}.`
        : `No suitable free bed available for ${student.student_code}.`,
      detail,
    );
  }

  candidates.sort((a, b) => {
    if (b.evaluation.score !== a.evaluation.score) return b.evaluation.score - a.evaluation.score;
    const occupancyA = roomOccupancy(a.bed.room_id);
    const occupancyB = roomOccupancy(b.bed.room_id);
    if (occupancyA !== occupancyB) return occupancyA - occupancyB;
    if (a.bed.floor !== b.bed.floor) return a.bed.floor - b.bed.floor;
    if (a.bed.hostel_name !== b.bed.hostel_name) {
      return a.bed.hostel_name.localeCompare(b.bed.hostel_name);
    }
    return String(a.bed.room_number).localeCompare(String(b.bed.room_number));
  });

  const chosen = candidates[0];

  const autoNote =
    notes ??
    [
      'Auto-allocated',
      chosen.evaluation.metPreferred.length
        ? `preferences met: ${chosen.evaluation.metPreferred.join(', ')}`
        : null,
      chosen.evaluation.unmetPreferred.length
        ? `preferences NOT met: ${chosen.evaluation.unmetPreferred.join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('; ');

  return transact(() => {
    const allocationId = insertAllocation({
      studentId: student.id,
      bedId: chosen.bed.bed_id,
      actor,
      notes: autoNote,
    });

    auditLog({
      actor,
      action: 'allocation.auto_assigned',
      entity: 'allocations',
      entityId: allocationId,
      detail: `${student.student_code} -> ${chosen.bed.hostel_name} ${chosen.bed.room_number}/${chosen.bed.bed_label}`,
    });

    return getAllocationById(allocationId);
  });
}

function roomOccupancy(roomId) {
  return Number(
    getDb()
      .prepare("SELECT COUNT(*) AS count FROM allocations a JOIN beds b ON b.id = a.bed_id WHERE b.room_id = ? AND a.status IN ('assigned','checked_in')")
      .get(Number(roomId)).count,
  );
}

/**
 * Place a student in a specific bed.
 * Requires `confirmOverride: true` when only *preferred* conditions are missed
 * (never for required ones - those are refused outright).
 */
export function allocateToBed(studentIdentifier, bedId, actor, { confirmOverride = false, reason = null } = {}) {
  assertPermission(actor, PERMISSIONS.ALLOCATION_MANAGE);
  const check = validatePlacement(studentIdentifier, bedId);
  if (!check.ok) {
    throw new EligibilityError(
      `Cannot allocate ${check.student.student_code} to bed ${check.bed.hostel_name} ${check.bed.room_number}/${check.bed.bed_label}.`,
      check.reasons,
    );
  }

  assertStudentActive(check.student.id);
  assertStudentFree(check.student.id);

  const unmetPreferred = check.evaluation.unmetPreferred;
  if (unmetPreferred.length && !confirmOverride) {
    throw new ValidationError(
      `Preferred (not required) conditions cannot be met: ${unmetPreferred.join(', ')}. Confirm to override.`,
    );
  }

  const studentId = check.student.id;
  const bedRow = check.bed;

  return transact(() => {
    const notes = unmetPreferred.length
      ? `Manual override (preferences unmet: ${unmetPreferred.join(', ')}). Reason: ${reason ?? 'not supplied'}`
      : reason
        ? `Manual allocation. Reason: ${reason}`
        : 'Manual allocation';

    const allocationId = insertAllocation({ studentId, bedId: bedRow.bed_id, actor, notes });

    auditLog({
      actor,
      action: 'allocation.assigned',
      entity: 'allocations',
      entityId: allocationId,
      detail: `${check.student.student_code} -> ${bedRow.hostel_name} ${bedRow.room_number}/${bedRow.bed_label}${
        unmetPreferred.length ? ` | override: ${unmetPreferred.join(', ')}` : ''
      }`,
    });

    return getAllocationById(allocationId);
  });
}

/** Cancel an assignment (student never checked in). */
export function cancelAllocation(allocationId, actor, { reason = null } = {}) {
  assertPermission(actor, PERMISSIONS.ALLOCATION_MANAGE);
  const allocation = getAllocationById(allocationId);
  if (!allocation) throw new NotFoundError(`Allocation #${allocationId} was not found.`);
  if (allocation.status === 'checked_in') {
    throw new ConflictError('Student is checked in. Check the student out instead of cancelling.');
  }
  if (allocation.status !== 'assigned') {
    throw new ConflictError(`Allocation #${allocationId} is already ${allocation.status}.`);
  }

  getDb()
    .prepare(
      "UPDATE allocations SET status = 'cancelled', cancelled_at = datetime('now'), notes = COALESCE(?, notes) WHERE id = ?",
    )
    .run(reason ? `Cancelled: ${reason}` : null, allocation.id);

  auditLog({
    actor,
    action: 'allocation.cancelled',
    entity: 'allocations',
    entityId: allocation.id,
    detail: `${allocation.student_code} | ${allocation.hostel_name} ${allocation.room_number}/${allocation.bed_label}${
      reason ? ` | ${reason}` : ''
    }`,
  });

  return getAllocationById(allocation.id);
}

/** Move an assigned (not yet checked-in) student to a different bed. */
export function reassignBed(studentIdentifier, newBedId, actor, options = {}) {
  assertPermission(actor, PERMISSIONS.ALLOCATION_MANAGE);
  const student = resolveStudent(studentIdentifier);
  const current = getActiveAllocation(student.id);
  if (!current) throw new NotFoundError(`${student.student_code} has no active allocation to move.`);
  if (current.status === 'checked_in') {
    throw new ConflictError('Checked-in students cannot be moved directly. Check out first, then re-allocate.');
  }

  return transact(() => {
    cancelAllocation(current.id, actor, { reason: 'reassignment' });
    return allocateToBed(student.id, newBedId, actor, options);
  });
}

/** Enrich a bed row with the reason a student may or may not use it. */
export function explainBedForStudent(studentIdentifier, bedId) {
  const student = resolveStudent(studentIdentifier);
  const bed = getBed(bedId);
  const requirements = getRequirements(student.id);
  const evaluation = evaluateBed(requirements, bed, bed);
  const results = requirements.map((requirement) => ({
    ...requirement,
    satisfied: requirementSatisfied(requirement.code, bed, bed),
  }));
  return { student, bed, evaluation, results };
}
