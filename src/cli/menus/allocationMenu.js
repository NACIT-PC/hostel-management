/**
 * Allocation menu: eligibility assessment, automatic and manual placement.
 */
import { PERMISSIONS } from '../../security/permissions.js';
import * as allocationService from '../../services/allocationService.js';
import * as eligibilityService from '../../services/eligibilityService.js';
import * as hostelService from '../../services/hostelService.js';
import { requirementLabel } from '../../services/matching.js';
import { color, money, print, section, success, table, warn, keyValue } from '../ui.js';
import { confirm, integer, select, text, yesNo } from '../prompts.js';
import { runMenu, pickHostel, pickStudent } from './common.js';

export async function allocationMenu(actor) {
  await runMenu({
    title: 'Bed allocation',
    actor,
    options: [
      {
        label: 'Assess eligibility for a student',
        value: 'assess',
        permission: PERMISSIONS.ALLOCATION_MANAGE,
        run: () => assessFlow(),
      },
      {
        label: 'Auto-assign the best bed',
        value: 'auto',
        permission: PERMISSIONS.ALLOCATION_MANAGE,
        run: () => autoFlow(actor),
      },
      {
        label: 'Assign a specific bed (manual)',
        value: 'manual',
        permission: PERMISSIONS.ALLOCATION_MANAGE,
        run: () => manualFlow(actor),
      },
      {
        label: 'Suggest suitable beds for a student',
        value: 'suggest',
        permission: PERMISSIONS.ALLOCATION_MANAGE,
        run: () => suggestFlow(),
      },
      {
        label: 'Move a student to another bed',
        value: 'move',
        permission: PERMISSIONS.ALLOCATION_MANAGE,
        run: () => moveFlow(actor),
      },
      {
        label: 'Cancel an assignment (not yet checked in)',
        value: 'cancel',
        permission: PERMISSIONS.ALLOCATION_MANAGE,
        run: () => cancelFlow(actor),
      },
      {
        label: 'Active allocations',
        value: 'active',
        permission: PERMISSIONS.ALLOCATION_MANAGE,
        run: () => activeFlow(),
      },
    ],
  });
}

async function assessFlow() {
  const student = await pickStudent();
  if (!student) return;
  const verdict = eligibilityService.assessStudent(student.id);
  printEligibility(verdict);
}

export function printEligibility(verdict) {
  const { student, fee, requirements, hostels, placeable } = verdict;
  print(
    color.bold(
      `\n${student.full_name} (${student.student_code}) - ${student.gender}, ${student.year_form}`,
    ),
  );
  print(
    `  Overall verdict: ${
      verdict.eligible ? color.green('ELIGIBLE for bed allocation') : color.red('NOT ELIGIBLE')
    }`,
  );
  if (verdict.eligible) {
    print(color.dim(`  ${placeable.length} hostel(s) can take this student right now.`));
  } else {
    for (const reason of verdict.reasons) print(`  ${color.red('x')} ${reason}`);
  }

  print(section('Fee position'));
  print(
    `  Paid ${money(fee.total_paid, fee.currency)} of the required ${money(fee.required, fee.currency)} first deposit ${
      fee.meetsRequirement ? color.green('(satisfied)') : color.red('(not satisfied)')
    }`,
  );

  if (requirements.length) {
    print(section('Health / sensitivity requirements'));
    print(
      table(
        requirements.map((item) => ({
          ...item,
          meaning: requirementLabel(item.code),
          levelLabel: item.level === 'required' ? color.red('required') : color.yellow('preferred'),
        })),
        [
          { key: 'id', header: 'ID', align: 'right' },
          { key: 'code', header: 'Code' },
          { key: 'meaning', header: 'Meaning' },
          { key: 'levelLabel', header: 'Level', format: (row) => row.levelLabel },
        ],
        { empty: 'None recorded.' },
      ),
    );
  }

  print(section('Hostel by hostel'));
  print(
    table(
      hostels.map((entry) => ({
        ...entry,
        hostel_name: entry.hostel.name,
        rule: hostelService.hostelRuleText(entry.hostel),
        verdict: entry.eligible ? color.green('OK') : color.red('NO'),
        free: String(entry.freeBeds),
        suitable: String(entry.suitableBeds),
      })),
      [
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'rule', header: 'Rule' },
        { key: 'free', header: 'Free beds', align: 'right' },
        { key: 'suitable', header: 'Suitable', align: 'right' },
        { key: 'verdict', header: 'Verdict', format: (row) => row.verdict },
      ],
      { empty: 'No hostels registered.' },
    ),
  );

  for (const entry of hostels) {
    print(color.bold(`\n  ${entry.hostel.name}`));
    for (const check of entry.checks) {
      print(`    ${check.ok ? color.green('+') : color.red('-')} ${check.label}: ${color.dim(check.detail)}`);
    }
    if (entry.bestBeds?.length) {
      print(
        `    ${color.dim('best free beds:')} ${entry.bestBeds
          .map((bed) => `${bed.room_number}/${bed.bed_label}${Number(bed.floor) === 0 ? ' (ground)' : ''}`)
          .join(', ')}`,
      );
    }
  }
}

async function autoFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const scope = await select('Where should the bed be?', [
    { name: 'Any compatible hostel (recommended)', value: 'any' },
    { name: 'A specific hostel', value: 'one' },
  ]);

  let hostelIdentifier = null;
  if (scope === 'one') {
    const hostel = await pickHostel();
    if (!hostel) return;
    hostelIdentifier = hostel.id;
  }

  if (!(await confirm(`Automatically allocate a suitable bed to ${student.student_code}?`, true))) {
    print(color.dim('Cancelled.'));
    return;
  }

  const allocation = allocationService.autoAllocate(student.id, actor, { hostelIdentifier });
  print(success(`Allocated ${allocation.student_code} to ${allocation.hostel_name} room ${allocation.room_number}, bed ${allocation.bed_label}.`));
  printAllocationSummary(allocation);
  if (allocation.notes?.includes('preferences NOT met')) {
    print(
      warn(
        'Some *preferred* health preferences could not be met by the chosen bed. Required conditions were all satisfied.',
      ),
    );
  }
}

async function manualFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  print(section(`Free beds suitable for ${student.student_code}`));
  const candidates = allocationService.findCandidateBeds(student.id);
  if (!candidates.candidates.length) {
    print(warn('No bed currently satisfies every requirement for this student.'));
    if (candidates.rejected.length) {
      print(color.dim('  Closest options and why they were rejected:'));
      for (const item of candidates.rejected.slice(0, 8)) {
        print(
          color.dim(
            `   - ${item.bed.hostel_name} ${item.bed.room_number}/${item.bed.bed_label}: ${item.reasons.join(' ')}`,
          ),
        );
      }
    }
    return;
  }

  print(
    table(
      candidates.candidates
        .sort((a, b) => b.evaluation.score - a.evaluation.score)
        .slice(0, 30)
        .map((candidate) => ({
          ...candidate.bed,
          score: candidate.evaluation.score,
          preferences: candidate.evaluation.metPreferred.length
            ? candidate.evaluation.metPreferred.join(', ')
            : color.dim('none matched'),
        })),
      [
        { key: 'bed_id', header: 'Bed ID', align: 'right' },
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'bunk_level', header: 'Bunk' },
        { key: 'floor', header: 'Floor', format: (row) => (Number(row.floor) === 0 ? 'Ground' : row.floor) },
        { key: 'preferences', header: 'Preferences met', format: (row) => row.preferences },
      ],
    ),
  );

  const bedId = await integer('Bed ID to assign (0 to cancel)', { field: 'Bed ID', min: 0, default: 0 });
  if (!bedId) {
    print(color.dim('Cancelled.'));
    return;
  }

  const check = allocationService.validatePlacement(student.id, bedId);
  if (!check.ok) {
    print(warn('This bed cannot be used:'));
    for (const reason of check.reasons) print(`  ${color.red('x')} ${reason}`);
    return;
  }

  const unmetPreferred = check.evaluation.unmetPreferred;
  let override = false;
  let reason = null;
  if (unmetPreferred.length) {
    print(
      warn(
        `Preferred (not required) conditions not met: ${unmetPreferred.map((code) => requirementLabel(code)).join('; ')}`,
      ),
    );
    override = await yesNo('Assign anyway and record an override reason?', { default: false });
    if (!override) {
      print(color.dim('Cancelled.'));
      return;
    }
    reason = await text('Override reason (recorded for audit)', { field: 'Reason', max: 200 });
  }

  const allocation = allocationService.allocateToBed(student.id, bedId, actor, {
    confirmOverride: override,
    reason,
  });
  print(success(`Allocated ${allocation.student_code} to ${allocation.hostel_name} room ${allocation.room_number}, bed ${allocation.bed_label}.`));
  printAllocationSummary(allocation);
}

async function suggestFlow() {
  const student = await pickStudent();
  if (!student) return;

  const ranked = allocationService.findCandidateBeds(student.id);
  print(
    color.bold(
      `\nBest free beds for ${student.student_code} (${ranked.candidates.length} candidate(s), ${ranked.rejected.length} rejected)`,
    ),
  );
  print(
    table(
      ranked.candidates
        .sort((a, b) => b.evaluation.score - a.evaluation.score)
        .slice(0, 25)
        .map((candidate) => ({
          bedId: candidate.bed.bed_id,
          hostel: candidate.bed.hostel_name,
          room: candidate.bed.room_number,
          bed: candidate.bed.bed_label,
          bunk: candidate.bed.bunk_level,
          floor: Number(candidate.bed.floor) === 0 ? 'Ground' : candidate.bed.floor,
          preferences: candidate.evaluation.metPreferred.join(', ') || '-',
          unmet: candidate.evaluation.unmetPreferred.join(', ') || '-',
        })),
      [
        { key: 'bedId', header: 'Bed ID', align: 'right' },
        { key: 'hostel', header: 'Hostel' },
        { key: 'room', header: 'Room' },
        { key: 'bed', header: 'Bed' },
        { key: 'bunk', header: 'Bunk' },
        { key: 'floor', header: 'Floor' },
        { key: 'preferences', header: 'Preferences met' },
        { key: 'unmet', header: 'Preferences unmet' },
      ],
      { empty: 'No bed satisfies the requirements.' },
    ),
  );
}

async function moveFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const current = allocationService.getActiveAllocation(student.id);
  if (!current) {
    print(warn('This student has no active allocation.'));
    return;
  }
  print(
    keyValue([
      ['Current hostel', current.hostel_name],
      ['Current room / bed', `${current.room_number} / ${current.bed_label}`],
      ['Status', current.status],
    ]),
  );
  if (current.status === 'checked_in') {
    print(warn('Only assigned (not checked-in) students can be moved directly. Check out first.'));
    return;
  }

  const candidates = allocationService.findCandidateBeds(student.id);
  if (!candidates.candidates.length) {
    print(warn('No other suitable free bed is available.'));
    return;
  }
  const bedId = await select(
    'Move to',
    candidates.candidates.slice(0, 40).map((candidate) => ({
      name: `${candidate.bed.hostel_name} room ${candidate.bed.room_number} bed ${candidate.bed.bed_label} ${color.dim(`(id ${candidate.bed.bed_id}, floor ${candidate.bed.floor === 0 ? 'ground' : candidate.bed.floor})`)}`,
      value: candidate.bed.bed_id,
    })),
  );
  if (!(await confirm('Move this student to the selected bed?', true))) {
    print(color.dim('Cancelled.'));
    return;
  }
  const allocation = allocationService.reassignBed(student.id, bedId, actor);
  print(success(`Moved to ${allocation.hostel_name} room ${allocation.room_number}, bed ${allocation.bed_label}.`));
}

async function cancelFlow(actor) {
  const student = await pickStudent();
  if (!student) return;

  const allocations = allocationService.listAllocations({ studentIdentifier: student.id, status: 'assigned' });
  if (!allocations.length) {
    print(warn('This student has no pending (assigned) allocation to cancel.'));
    return;
  }
  const allocationId = await select(
    'Allocation to cancel',
    allocations.map((item) => ({
      name: `#${item.id} ${item.hostel_name} room ${item.room_number} bed ${item.bed_label} ${color.dim(`(assigned ${item.assigned_at})`)}`,
      value: item.id,
    })),
  );
  const reason = await text('Reason (optional)', { field: 'Reason', optional: true, max: 200 });
  if (!(await confirm('Cancel this assignment and release the bed?', false))) {
    print(color.dim('Cancelled.'));
    return;
  }
  allocationService.cancelAllocation(allocationId, actor, { reason });
  print(success('Assignment cancelled; the bed is free again.'));
}

async function activeFlow() {
  const rows = allocationService.listAllocations({ status: ['assigned', 'checked_in'] });
  print(
    table(
      rows.map((row) => ({
        ...row,
        status: row.status === 'checked_in' ? color.green('checked in') : color.yellow('assigned'),
      })),
      [
        { key: 'id', header: 'ID', align: 'right' },
        { key: 'student_code', header: 'Student ID' },
        { key: 'student_name', header: 'Name' },
        { key: 'hostel_name', header: 'Hostel' },
        { key: 'room_number', header: 'Room' },
        { key: 'bed_label', header: 'Bed' },
        { key: 'status', header: 'Status', format: (row) => row.status },
      ],
      { empty: 'No active allocations.' },
    ),
  );
}

function printAllocationSummary(allocation) {
  print(
    keyValue([
      ['Allocation #', String(allocation.id)],
      ['Hostel', allocation.hostel_name],
      ['Room / Bed', `${allocation.room_number} / ${allocation.bed_label}`],
      ['Status', allocation.status],
      ['Notes', allocation.notes ?? color.dim('-')],
    ]),
  );
  print(
    color.dim(
      '  Next step: check the student in (Check-in / Check-out menu) when they physically arrive.',
    ),
  );
}
