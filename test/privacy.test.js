/**
 * Privacy: health data masking, reveal permission and audit trail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, makeActors, studentService, auditService, security } from './helpers.js';

test('health notes are masked unless a privileged role reveals them', () => {
  resetDatabase();
  const actors = makeActors();

  const student = studentService.registerStudent(
    { studentCode: 'P-1', fullName: 'Private Person', gender: 'Female', yearForm: 'Year 1' },
    actors.clerk,
  );
  studentService.addHealthCondition(
    { studentIdentifier: student.id, code: 'FAN_REQUIRED', level: 'preferred', notes: 'Asthma flare-ups.' },
    actors.clerk,
  );
  studentService.setHealthNotes(student.id, 'Carries an inhaler at all times.', actors.clerk);

  const masked = studentService.getHealthProfile(student.id);
  assert.equal(masked.health_notes, '__PRIVATE__');
  assert.equal(masked.health_notes_private, true);
  assert.equal(masked.conditions[0].notes, '__PRIVATE__');
  assert.equal(masked.conditions[0].code, 'FAN_REQUIRED');
  assert.equal(masked.hasRestrictions, true);
});

test('only privileged roles may reveal health detail, and every reveal is audited', () => {
  resetDatabase();
  const actors = makeActors();

  const student = studentService.registerStudent(
    { studentCode: 'P-2', fullName: 'Private Two', gender: 'Female', yearForm: 'Year 1' },
    actors.clerk,
  );
  studentService.setHealthNotes(student.id, 'Carries an inhaler at all times.', actors.clerk);
  studentService.addHealthCondition(
    { studentIdentifier: student.id, code: 'FAN_REQUIRED', level: 'preferred', notes: 'Asthma flare-ups.' },
    actors.clerk,
  );

  // A clerk may not reveal the medical detail.
  assert.equal(security.can('clerk', security.PERMISSIONS.HEALTH_REVEAL), false);
  assert.equal(studentService.canRevealHealth(actors.clerk), false);
  assert.throws(
    () => studentService.getHealthProfile(student.id, { reveal: true, actor: actors.clerk }),
    (error) => error.code === 'PERMISSION_DENIED',
  );

  // A warden may reveal, and the access is written to the audit trail.
  assert.equal(studentService.canRevealHealth(actors.warden), true);
  const revealed = studentService.getHealthProfile(student.id, {
    reveal: true,
    actor: actors.warden,
    reason: 'allocation check',
  });
  assert.equal(revealed.health_notes, 'Carries an inhaler at all times.');
  assert.equal(revealed.conditions[0].notes, 'Asthma flare-ups.');

  const reveals = auditService.listAuditLog({ action: 'privacy.health_notes_revealed' });
  assert.equal(reveals.length, 1);
  assert.match(reveals[0].detail, /P-2/);
  assert.match(reveals[0].detail, /allocation check/);
});

test('the allocator sees requirement codes and levels, never the free text', () => {
  resetDatabase();
  const actors = makeActors();

  const student = studentService.registerStudent(
    { studentCode: 'P-3', fullName: 'Private Three', gender: 'Female', yearForm: 'Year 1' },
    actors.clerk,
  );
  studentService.setHealthNotes(student.id, 'Sensitive free text.', actors.clerk);
  studentService.addHealthCondition(
    { studentIdentifier: student.id, code: 'QUIET_ROOM', level: 'required', notes: 'Private condition note.' },
    actors.clerk,
  );

  const requirements = studentService.getRequirements(student.id);
  assert.equal(requirements.length, 1);
  assert.deepEqual(Object.keys(requirements[0]).sort(), ['code', 'id', 'level']);
  assert.equal(requirements[0].code, 'QUIET_ROOM');
  assert.equal(requirements[0].level, 'required');

  // Listings expose only the fact that notes exist - never their content.
  const listed = studentService.listStudents().find((row) => row.id === student.id);
  assert.equal(listed.has_health_notes, 1);
  assert.equal(listed.health_condition_count, 1);
  assert.equal('health_notes' in listed, false);
});
