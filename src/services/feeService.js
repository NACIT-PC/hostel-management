import { getDb } from '../db/connection.js';
import { FEE_TYPES, PAYMENT_METHODS } from '../config.js';
import { assertPermission, PERMISSIONS } from '../security/permissions.js';
import { log as auditLog } from './auditService.js';
import { getFirstDepositRequirement, getCurrency } from './settingsService.js';
import { resolveStudent, getStudentSummaryRow } from './studentService.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { asAmount, asOneOf, asDate, asText } from '../utils/validate.js';

export function recordPayment(input, actor) {
  assertPermission(actor, PERMISSIONS.FEE_MANAGE);
  const student = resolveStudent(input.studentIdentifier);
  const amount = asAmount(input.amount, 'Amount');
  const feeType = asOneOf(input.feeType ?? 'first_deposit', FEE_TYPES, 'Fee type');
  const method = asOneOf(input.method ?? 'Cash', PAYMENT_METHODS, 'Payment method');
  const paidOn = asDate(input.paidOn, 'Payment date', { optional: true }) ?? today();
  const reference = input.reference ? asText(input.reference, 'Receipt reference', { max: 60 }) : null;
  const note = input.note ? asText(input.note, 'Note', { max: 300 }) : null;

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO fee_payments (student_id, amount, fee_type, method, reference, paid_on, note, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(student.id, amount, feeType, method, reference, paidOn, note, actor?.id ?? null);

  auditLog({
    actor,
    action: 'fee.recorded',
    entity: 'fee_payments',
    entityId: Number(info.lastInsertRowid),
    detail: `${student.student_code} | ${feeType} | ${amount} | ${method} | ${paidOn}`,
  });

  return {
    payment: db.prepare('SELECT * FROM fee_payments WHERE id = ?').get(Number(info.lastInsertRowid)),
    summary: getFeeSummary(student.id),
  };
}

export function listPayments(studentIdentifier) {
  const student = resolveStudent(studentIdentifier);
  return getDb()
    .prepare(
      `SELECT f.id, f.amount, f.fee_type, f.method, f.reference, f.paid_on, f.note, f.created_at,
              COALESCE(u.username, 'system') AS recorded_by
         FROM fee_payments f
         LEFT JOIN users u ON u.id = f.recorded_by
        WHERE f.student_id = ?
        ORDER BY f.paid_on DESC, f.id DESC`,
    )
    .all(student.id);
}

export function deletePayment(paymentId, actor) {
  assertPermission(actor, PERMISSIONS.FEE_MANAGE);
  const db = getDb();
  const payment = db.prepare('SELECT * FROM fee_payments WHERE id = ?').get(Number(paymentId));
  if (!payment) throw new NotFoundError(`Payment #${paymentId} was not found.`);

  const student = getStudentSummaryRow(payment.student_id);
  if (student?.allocation_id && student.allocation_status === 'checked_in') {
    throw new ValidationError(
      'This student is checked in. Check out first, then correct the payment record.',
    );
  }

  db.prepare('DELETE FROM fee_payments WHERE id = ?').run(payment.id);
  auditLog({
    actor,
    action: 'fee.deleted',
    entity: 'fee_payments',
    entityId: payment.id,
    detail: `amount ${payment.amount} removed (correction)`,
  });
  return getFeeSummary(payment.student_id);
}

export function totalPaid(studentId) {
  return Number(
    getDb().prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM fee_payments WHERE student_id = ?').get(Number(studentId))
      .total,
  );
}

export function getFeeSummary(studentId) {
  const db = getDb();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS payment_count,
              COALESCE(SUM(amount), 0) AS total_paid,
              MIN(paid_on) AS first_deposit_on
         FROM fee_payments WHERE student_id = ?`,
    )
    .get(Number(studentId));

  const byType = db
    .prepare('SELECT fee_type, COALESCE(SUM(amount), 0) AS total FROM fee_payments WHERE student_id = ? GROUP BY fee_type')
    .all(Number(studentId))
    .reduce((acc, row) => ({ ...acc, [row.fee_type]: Number(row.total) }), {});

  const required = getFirstDepositRequirement();
  const totalPaidValue = Number(totals.total_paid);

  return {
    student_id: Number(studentId),
    total_paid: totalPaidValue,
    required,
    balance: Math.max(0, required - totalPaidValue),
    meetsRequirement: totalPaidValue >= required,
    first_deposit_on: totals.first_deposit_on ?? null,
    payment_count: Number(totals.payment_count),
    fee_type_totals: byType,
    currency: getCurrency(),
  };
}

export function feeStatusReport({ onlyShortfall = false } = {}) {
  const required = getFirstDepositRequirement();
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.student_code, s.full_name, s.gender, s.year_form,
              COALESCE(f.total_paid, 0) AS total_paid,
              COALESCE(f.payment_count, 0) AS payment_count,
              f.first_payment_on, f.last_payment_on
         FROM students s
         LEFT JOIN v_student_fees f ON f.student_id = s.id
        ORDER BY s.full_name COLLATE NOCASE`,
    )
    .all()
    .map((row) => ({
      ...row,
      total_paid: Number(row.total_paid),
      required,
      meetsRequirement: Number(row.total_paid) >= required,
      shortfall: Math.max(0, required - Number(row.total_paid)),
    }));

  return onlyShortfall ? rows.filter((row) => !row.meetsRequirement) : rows;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
