import { getDb, transact } from '../db/connection.js';
import { GENDERS, YEAR_FORMS, HEALTH_REQUIREMENT_CODES, HEALTH_REQUIREMENT_LEVELS, LIMITS } from '../config.js';
import { assertPermission, PERMISSIONS, can } from '../security/permissions.js';
import { log as auditLog } from './auditService.js';
import { ConflictError, NotFoundError, PermissionError, ValidationError } from '../utils/errors.js';
import { asText, asCode, asOneOf, asEmail, asPhone } from '../utils/validate.js';

const VALID_CODES = HEALTH_REQUIREMENT_CODES.map((entry) => entry.code);

export function listStudents({ gender = null, yearForm = null, search = null, onlyActive = false } = {}) {
  const conditions = [];
  const params = [];
  if (gender) {
    conditions.push('s.gender = ?');
    params.push(gender);
  }
  if (yearForm) {
    conditions.push('s.year_form = ?');
    params.push(yearForm);
  }
  if (search) {
    conditions.push('(s.full_name LIKE ? OR s.student_code LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (onlyActive) conditions.push('s.is_active = 1');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return getDb()
    .prepare(
      `SELECT s.id, s.student_code, s.full_name, s.gender, s.year_form, s.phone, s.email,
              s.is_active, s.created_at,
              CASE WHEN s.health_notes IS NOT NULL AND TRIM(s.health_notes) <> '' THEN 1 ELSE 0 END AS has_health_notes,
              (SELECT COUNT(*) FROM student_health_conditions c WHERE c.student_id = s.id) AS health_condition_count,
              COALESCE(f.total_paid, 0) AS total_paid,
              a.id      AS allocation_id,
              a.status  AS allocation_status,
              h.name    AS hostel_name,
              r.room_number,
              b.label   AS bed_label
         FROM students s
         LEFT JOIN v_student_fees f ON f.student_id = s.id
         LEFT JOIN allocations a ON a.student_id = s.id AND a.status IN ('assigned', 'checked_in')
         LEFT JOIN beds b   ON b.id = a.bed_id
         LEFT JOIN rooms r  ON r.id = b.room_id
         LEFT JOIN hostels h ON h.id = r.hostel_id
         ${where}
         ORDER BY s.full_name COLLATE NOCASE
         LIMIT ?`,
    )
    .all(...params, LIMITS.SEARCH_LIMIT);
}

export function getStudentById(id) {
  return getDb().prepare('SELECT * FROM students WHERE id = ?').get(Number(id));
}

export function resolveStudent(identifier) {
  if (identifier === undefined || identifier === null || String(identifier).trim() === '') {
    throw new ValidationError('Student identifier is required.');
  }
  const db = getDb();
  const raw = String(identifier).trim();
  let row = null;
  if (/^\d+$/.test(raw)) row = db.prepare('SELECT * FROM students WHERE id = ?').get(Number(raw));
  if (!row) {
    row = db.prepare('SELECT * FROM students WHERE student_code = ? COLLATE NOCASE').get(raw);
  }
  if (!row) throw new NotFoundError(`Student "${raw}" was not found.`);
  return row;
}

export function getStudentSummaryRow(studentId) {
  return getDb()
    .prepare(
      `SELECT s.*, COALESCE(f.total_paid, 0) AS total_paid,
              a.id AS allocation_id, a.status AS allocation_status,
              h.name AS hostel_name, r.room_number, b.label AS bed_label
         FROM students s
         LEFT JOIN v_student_fees f ON f.student_id = s.id
         LEFT JOIN allocations a ON a.student_id = s.id AND a.status IN ('assigned', 'checked_in')
         LEFT JOIN beds b  ON b.id = a.bed_id
         LEFT JOIN rooms r ON r.id = b.room_id
         LEFT JOIN hostels h ON h.id = r.hostel_id
        WHERE s.id = ?`,
    )
    .get(Number(studentId));
}

export function registerStudent(input, actor) {
  assertPermission(actor, PERMISSIONS.STUDENT_MANAGE);
  const studentCode = asCode(input.studentCode, 'Student ID', { max: 40 });
  const fullName = asText(input.fullName, 'Student name', { max: 120 });
  const gender = asOneOf(input.gender, GENDERS, 'Gender');
  const yearForm = asOneOf(input.yearForm, YEAR_FORMS, 'Year / form');
  const phone = asPhone(input.phone, 'Phone');
  const email = asEmail(input.email, 'Email');
  const healthNotes = input.healthNotes ? asText(input.healthNotes, 'Health notes', { max: 1000 }) : null;

  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM students WHERE student_code = ? COLLATE NOCASE')
    .get(studentCode);
  if (existing) throw new ConflictError(`Student ID "${studentCode}" is already registered.`);

  const info = db
    .prepare(
      `INSERT INTO students (student_code, full_name, gender, year_form, phone, email, health_notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(studentCode, fullName, gender, yearForm, phone, email, healthNotes, actor?.id ?? null);

  const studentId = Number(info.lastInsertRowid);
  auditLog({
    actor,
    action: 'student.registered',
    entity: 'students',
    entityId: studentId,
    detail: `${studentCode} | ${fullName} | ${gender} | ${yearForm}${healthNotes ? ' | private notes recorded' : ''}`,
  });
  return getStudentById(studentId);
}

export function updateStudent(identifier, changes, actor) {
  assertPermission(actor, PERMISSIONS.STUDENT_MANAGE);
  const student = resolveStudent(identifier);
  const db = getDb();

  const updates = [];
  const params = [];
  const auditDetail = {};

  if (changes.fullName !== undefined) {
    updates.push('full_name = ?');
    params.push(asText(changes.fullName, 'Student name', { max: 120 }));
    auditDetail.fullName = changes.fullName;
  }
  if (changes.gender !== undefined) {
    updates.push('gender = ?');
    params.push(asOneOf(changes.gender, GENDERS, 'Gender'));
    auditDetail.gender = changes.gender;
  }
  if (changes.yearForm !== undefined) {
    updates.push('year_form = ?');
    params.push(asOneOf(changes.yearForm, YEAR_FORMS, 'Year / form'));
    auditDetail.yearForm = changes.yearForm;
  }
  if (changes.phone !== undefined) {
    updates.push('phone = ?');
    params.push(asPhone(changes.phone, 'Phone'));
    auditDetail.phone = changes.phone;
  }
  if (changes.email !== undefined) {
    updates.push('email = ?');
    params.push(asEmail(changes.email, 'Email'));
    auditDetail.email = changes.email;
  }
  if (changes.isActive !== undefined) {
    updates.push('is_active = ?');
    params.push(changes.isActive ? 1 : 0);
    auditDetail.isActive = Boolean(changes.isActive);
  }

  if (!updates.length) throw new ValidationError('Nothing to update.');

  db.prepare(
    `UPDATE students SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...params, student.id);

  auditLog({
    actor,
    action: 'student.updated',
    entity: 'students',
    entityId: student.id,
    detail: auditDetail,
  });
  return getStudentById(student.id);
}

export function setHealthNotes(identifier, notes, actor) {
  assertPermission(actor, PERMISSIONS.STUDENT_MANAGE);
  const student = resolveStudent(identifier);
  const clean = notes === null || notes === undefined || String(notes).trim() === ''
    ? null
    : asText(notes, 'Health notes', { max: 1000 });

  getDb()
    .prepare("UPDATE students SET health_notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(clean, student.id);

  auditLog({
    actor,
    action: clean ? 'student.health_notes_updated' : 'student.health_notes_cleared',
    entity: 'students',
    entityId: student.id,
    detail: clean ? 'sensitive content stored (not logged)' : 'cleared',
  });
  return getStudentById(student.id);
}

export function addHealthCondition({ studentIdentifier, code, level = 'required', notes = null }, actor) {
  assertPermission(actor, PERMISSIONS.STUDENT_MANAGE);
  const student = resolveStudent(studentIdentifier);
  const cleanCode = asOneOf(code, VALID_CODES, 'Requirement code');
  const cleanLevel = asOneOf(level, HEALTH_REQUIREMENT_LEVELS, 'Requirement level');
  const cleanNotes = notes ? asText(notes, 'Condition notes', { max: 500 }) : null;

  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM student_health_conditions WHERE student_id = ? AND code = ?')
    .get(student.id, cleanCode);

  if (existing) {
    db.prepare(
      "UPDATE student_health_conditions SET level = ?, notes = ?, recorded_by = ?, created_at = datetime('now') WHERE id = ?",
    ).run(cleanLevel, cleanNotes, actor?.id ?? null, existing.id);
    auditLog({
      actor,
      action: 'student.health_condition_updated',
      entity: 'student_health_conditions',
      entityId: existing.id,
      detail: `${student.student_code}: ${cleanCode} (${cleanLevel})`,
    });
    return existing.id;
  }

  const info = db
    .prepare(
      'INSERT INTO student_health_conditions (student_id, code, level, notes, recorded_by) VALUES (?, ?, ?, ?, ?)',
    )
    .run(student.id, cleanCode, cleanLevel, cleanNotes, actor?.id ?? null);

  auditLog({
    actor,
    action: 'student.health_condition_added',
    entity: 'student_health_conditions',
    entityId: Number(info.lastInsertRowid),
    detail: `${student.student_code}: ${cleanCode} (${cleanLevel})`,
  });
  return Number(info.lastInsertRowid);
}

export function removeHealthCondition(conditionId, actor) {
  assertPermission(actor, PERMISSIONS.STUDENT_MANAGE);
  const db = getDb();
  const row = db.prepare('SELECT * FROM student_health_conditions WHERE id = ?').get(Number(conditionId));
  if (!row) throw new NotFoundError(`Health condition #${conditionId} was not found.`);
  db.prepare('DELETE FROM student_health_conditions WHERE id = ?').run(row.id);
  auditLog({
    actor,
    action: 'student.health_condition_removed',
    entity: 'student_health_conditions',
    entityId: row.id,
    detail: `code ${row.code}`,
  });
  return true;
}

export function getRequirements(studentId) {
  return getDb()
    .prepare(
      'SELECT id, code, level FROM student_health_conditions WHERE student_id = ? ORDER BY level, code',
    )
    .all(Number(studentId));
}

export function getHealthProfile(identifier, { reveal = false, actor = null, reason = null } = {}) {
  const student = resolveStudent(identifier);
  const db = getDb();

  if (reveal && !can(actor?.role, PERMISSIONS.HEALTH_REVEAL)) {
    throw new PermissionError(
      'Your role may view the fact that a student has special needs, but not the medical detail.',
    );
  }

  const notes = reveal
    ? student.health_notes
    : student.health_notes
      ? '__PRIVATE__'
      : null;

  const conditions = db
    .prepare(
      'SELECT id, code, level, notes, created_at FROM student_health_conditions WHERE student_id = ? ORDER BY level, code',
    )
    .all(student.id)
    .map((condition) => ({
      id: condition.id,
      code: condition.code,
      level: condition.level,
      notes: reveal ? condition.notes : condition.notes ? '__PRIVATE__' : null,
      created_at: condition.created_at,
    }));

  if (reveal && (student.health_notes || conditions.some((item) => item.notes))) {
    auditLog({
      actor,
      action: 'privacy.health_notes_revealed',
      entity: 'students',
      entityId: student.id,
      detail: `${student.student_code}${reason ? ` | reason: ${reason}` : ''}`,
    });
  }

  return {
    student: {
      id: student.id,
      student_code: student.student_code,
      full_name: student.full_name,
      gender: student.gender,
      year_form: student.year_form,
    },
    reveal,
    health_notes: notes,
    health_notes_private: !reveal && Boolean(student.health_notes),
    conditions,
    hasRestrictions: Boolean(student.health_notes) || conditions.length > 0,
  };
}

export function healthIndicator(studentRow) {
  if (!studentRow) return 'No';
  if (studentRow.health_condition_count > 0 || studentRow.has_health_notes) return 'Yes';
  return 'No';
}

export function canRevealHealth(actor) {
  return can(actor?.role, PERMISSIONS.HEALTH_REVEAL);
}

export function deleteStudent(identifier, actor) {
  assertPermission(actor, PERMISSIONS.STUDENT_MANAGE);
  const student = resolveStudent(identifier);
  const db = getDb();

  const allocations = db.prepare('SELECT COUNT(*) AS count FROM allocations WHERE student_id = ?').get(student.id).count;
  const payments = db.prepare('SELECT COUNT(*) AS count FROM fee_payments WHERE student_id = ?').get(student.id).count;
  if (allocations > 0 || payments > 0) {
    throw new ConflictError(
      'This student has fee/allocation history and cannot be deleted. Mark the student inactive instead.',
    );
  }

  transact(() => {
    db.prepare('DELETE FROM student_health_conditions WHERE student_id = ?').run(student.id);
    db.prepare('DELETE FROM students WHERE id = ?').run(student.id);
  });

  auditLog({
    actor,
    action: 'student.deleted',
    entity: 'students',
    entityId: student.id,
    detail: student.student_code,
  });
  return true;
}
