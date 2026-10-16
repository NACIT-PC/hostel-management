import { FEE_TYPES, PAYMENT_METHODS } from '../../config.js';
import { PERMISSIONS } from '../../security/permissions.js';
import * as feeService from '../../services/feeService.js';
import { getCurrency } from '../../services/settingsService.js';
import { color, print, success, table, warn } from '../ui.js';
import { amount, confirm, select, text } from '../prompts.js';
import { runMenu, pickStudent } from './common.js';

export async function feeMenu(actor) {
  await runMenu({
    title: 'Fee registration',
    actor,
    options: [
      {
        label: 'Record a fee payment',
        value: 'record',
        permission: PERMISSIONS.FEE_MANAGE,
        run: () => recordFlow(actor),
      },
      {
        label: 'View a student\'s payments & eligibility',
        value: 'list',
        permission: PERMISSIONS.FEE_MANAGE,
        run: () => listFlow(),
      },
      {
        label: 'Fee status for every student',
        value: 'status',
        permission: PERMISSIONS.FEE_MANAGE,
        run: () => statusFlow(),
      },
      {
        label: 'Students short of the first deposit',
        value: 'shortfall',
        permission: PERMISSIONS.FEE_MANAGE,
        run: () => statusFlow({ onlyShortfall: true }),
      },
      {
        label: 'Correct (delete) a payment record',
        value: 'delete',
        permission: PERMISSIONS.FEE_MANAGE,
        run: () => deleteFlow(actor),
      },
    ],
  });
}

async function recordFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const currency = getCurrency();
  const money2 = await amount(`Amount received (${currency})`, { field: 'Amount' });
  const feeType = await select('Payment type', [
    { name: 'First deposit (grants allocation eligibility)', value: 'first_deposit' },
    { name: 'Balance / later instalment', value: 'balance' },
    { name: 'Other (registration, caution money, ...)', value: 'other' },
  ]);
  const method = await select('Method', PAYMENT_METHODS.map((item) => ({ name: item, value: item })));
  const reference = await text('Receipt / transaction reference (optional)', {
    field: 'Receipt reference',
    optional: true,
    max: 60,
  });
  const note = await text('Note (optional)', { field: 'Note', optional: true, max: 300 });

  const { summary } = feeService.recordPayment(
    { studentIdentifier: student.id, amount: money2, feeType, method, reference, note },
    actor,
  );

  print(success(`Payment recorded for ${student.student_code}.`));
  print(
    `  Total paid: ${summary.total_paid} ${summary.currency} of ${summary.required} required - ${
      summary.meetsRequirement ? color.green('ELIGIBLE for allocation') : color.red('still short')
    }`,
  );
  if (feeType === 'first_deposit' && !summary.meetsRequirement) {
    print(warn('The first deposit policy is not yet satisfied; the student cannot be allocated a bed.'));
  }
}

async function listFlow() {
  const student = await pickStudent();
  if (!student) return;

  const currency = getCurrency();
  const payments = feeService.listPayments(student.id);
  const summary = feeService.getFeeSummary(student.id);

  print(color.bold(`\nPayments for ${student.student_code} - ${student.full_name}`));
  print(
    table(
      payments,
      [
        { key: 'id', header: 'ID', align: 'right' },
        { key: 'paid_on', header: 'Date' },
        { key: 'amount', header: 'Amount', align: 'right' },
        { key: 'fee_type', header: 'Type' },
        { key: 'method', header: 'Method' },
        { key: 'reference', header: 'Reference', format: (row) => row.reference ?? color.dim('-') },
        { key: 'recorded_by', header: 'Recorded by' },
      ],
      { empty: 'No payments recorded yet.' },
    ),
  );

  print(
    `\n  Total: ${color.bold(`${summary.total_paid} ${currency}`)} | required first deposit: ${summary.required} ${currency} | ${
      summary.meetsRequirement ? color.green('ELIGIBLE') : color.red('NOT ELIGIBLE')
    }`,
  );
}

async function statusFlow({ onlyShortfall = false } = {}) {
  const currency = getCurrency();
  const rows = feeService.feeStatusReport({ onlyShortfall });
  print(
    table(
      rows.map((row) => ({
        ...row,
        status: row.meetsRequirement ? color.green('eligible') : color.red(`short ${row.shortfall}`),
      })),
      [
        { key: 'student_code', header: 'Student ID' },
        { key: 'full_name', header: 'Name' },
        { key: 'year_form', header: 'Year/Form' },
        { key: 'total_paid', header: 'Paid', align: 'right' },
        { key: 'required', header: 'Required', align: 'right' },
        { key: 'status', header: 'Status', format: (row) => row.status },
      ],
      { empty: onlyShortfall ? 'Every student has met the deposit requirement.' : 'No students registered.' },
    ),
  );
  const short = rows.filter((row) => !row.meetsRequirement).length;
  print(color.dim(`\n  ${rows.length} student(s) shown; ${short} short of the requirement (${currency}).`));
}

async function deleteFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const payments = feeService.listPayments(student.id);
  if (!payments.length) {
    print(warn('This student has no payments to correct.'));
    return;
  }
  const paymentId = await select(
    'Payment to delete',
    payments.map((payment) => ({
      name: `#${payment.id} ${payment.paid_on} ${payment.amount} (${payment.fee_type}, ${payment.method})`,
      value: payment.id,
    })),
  );
  if (!(await confirm('Delete this payment record? This changes the student\'s eligibility.', false))) {
    print(color.dim('Cancelled.'));
    return;
  }
  const summary = feeService.deletePayment(paymentId, actor);
  print(success('Payment deleted.'));
  print(
    `  New total: ${summary.total_paid} ${summary.currency} - ${
      summary.meetsRequirement ? color.green('still eligible') : color.red('no longer eligible')
    }`,
  );
}
