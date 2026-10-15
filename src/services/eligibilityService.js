/**
 * Eligibility assessment.
 *
 * Eligibility = fee deposit satisfied AND gender/year compatible AND a bed
 * exists that satisfies every *required* health/sensitivity condition.
 *
 * `assessStudent()` explains the verdict check-by-check - the CLI prints these
 * details so a clerk always knows exactly why a student was refused.
 */
import { listHostels, listFreeBeds, hostelRuleText, getHostel } from './hostelService.js';
import { getFeeSummary } from './feeService.js';
import { resolveStudent, getRequirements } from './studentService.js';
import { hostelAcceptsStudent, evaluateBed, requirementLabel } from './matching.js';
import { getCurrency, getFirstDepositRequirement } from './settingsService.js';
import { money as formatMoney } from '../utils/format.js';

/** Fee-only check (used before check-in as well). */
export function assessFees(studentIdentifier) {
  const student = resolveStudent(studentIdentifier);
  const summary = getFeeSummary(student.id);
  return {
    student,
    ...summary,
    currency: summary.currency || getCurrency(),
    required: getFirstDepositRequirement(),
    ok: summary.meetsRequirement,
  };
}

/**
 * Per-hostel verdict for one student.
 * @returns {Array<object>} one entry per hostel with checks + suitable bed count
 */
export function assessHostels(studentIdentifier, { onlyCompatible = false } = {}) {
  const student = resolveStudent(studentIdentifier);
  const fee = assessFees(student.id);
  const requirements = getRequirements(student.id);
  const requiredHealth = requirements.filter((item) => item.level === 'required');

  return listHostels()
    .map((hostel) => {
      const hostelRule = hostelAcceptsStudent(hostel, student);
      const freeBeds = hostelRule.ok ? listFreeBeds({ hostelId: hostel.id }) : [];
      const bedEvaluations = freeBeds.map((bed) => ({
        bed,
        evaluation: evaluateBed(requirements, bed, bed),
      }));
      const suitable = bedEvaluations.filter((entry) => entry.evaluation.hardOk);
      const nearMisses = bedEvaluations
        .filter((entry) => !entry.evaluation.hardOk)
        .map((entry) => ({
          room: entry.bed.room_number,
          bed: entry.bed.bed_label,
          unmet: entry.evaluation.unmetRequired,
        }));

      const checks = [
        {
          label: 'Gender / year compatibility',
          ok: hostelRule.ok,
          detail: hostelRule.ok
            ? `Hostel rule: ${hostelRuleText(hostel)}`
            : hostelRule.reasons.join(' '),
        },
        {
          label: 'Fee deposit',
          ok: fee.ok,
          detail: fee.ok
            ? `Paid ${formatMoney(fee.total_paid, fee.currency)} (required ${formatMoney(fee.required, fee.currency)})`
            : `Only ${formatMoney(fee.total_paid, fee.currency)} recorded; ${formatMoney(
                fee.required - fee.total_paid,
                fee.currency,
              )} short of the required first deposit.`,
        },
        {
          label: 'Free bed available',
          ok: hostelRule.ok && freeBeds.length > 0,
          detail: hostelRule.ok
            ? `${freeBeds.length} free bed(s).`
            : 'Hostel does not accept this student.',
        },
        {
          label: 'Health & sensitivity requirements',
          ok: hostelRule.ok && freeBeds.length > 0 && suitable.length > 0,
          detail:
            requiredHealth.length === 0
              ? 'No enforceable requirements recorded.'
              : suitable.length > 0
                ? `${suitable.length} bed(s) satisfy: ${requiredHealth.map((item) => item.code).join(', ')}.`
                : `No free bed satisfies: ${requiredHealth.map((item) => requirementLabel(item.code)).join('; ')}.`,
        },
      ];

      const eligible = checks.every((check) => check.ok);

      return {
        hostel,
        eligible,
        checks,
        freeBeds: freeBeds.length,
        suitableBeds: suitable.length,
        bestBeds: suitable
          .sort((a, b) => b.evaluation.score - a.evaluation.score)
          .slice(0, 3)
          .map((entry) => entry.bed),
        nearMisses,
      };
    })
    .filter((entry) => (onlyCompatible ? entry.checks[0].ok : true));
}

/** Overall verdict for one student across every hostel. */
export function assessStudent(studentIdentifier) {
  const student = resolveStudent(studentIdentifier);
  const fee = assessFees(student.id);
  const requirements = getRequirements(student.id);
  const hostels = assessHostels(student.id);
  const placeable = hostels.filter((entry) => entry.eligible);

  const reasons = [];
  if (!fee.ok) {
    reasons.push(
      `Fee deposit incomplete: ${formatMoney(fee.total_paid, fee.currency)} of ${formatMoney(
        fee.required,
        fee.currency,
      )}.`,
    );
  }
  if (hostels.every((entry) => !entry.checks[0].ok)) {
    reasons.push(`No hostel matches gender (${student.gender}) and year/form (${student.year_form}).`);
  }
  if (placeable.length === 0 && hostels.some((entry) => entry.checks[0].ok && entry.freeBeds === 0)) {
    reasons.push('Matching hostel(s) are currently full.');
  }
  if (
    requirements.some((item) => item.level === 'required') &&
    hostels.some((entry) => entry.checks[0].ok) &&
    placeable.length === 0
  ) {
    reasons.push('No free bed satisfies the required health/sensitivity conditions.');
  }

  return {
    student,
    fee,
    requirements,
    hostels,
    placeable,
    eligible: fee.ok && placeable.length > 0,
    reasons,
  };
}

/** Convenience: is this student allowed to be checked into this hostel? */
export function assessForHostel(studentIdentifier, hostelIdentifier) {
  const hostel = getHostel(hostelIdentifier);
  const entry = assessHostels(studentIdentifier).find((item) => item.hostel.id === hostel.id);
  if (!entry) throw new Error(`Hostel ${hostel.name} could not be assessed.`);
  return entry;
}
