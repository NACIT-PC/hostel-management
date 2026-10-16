import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshSetup,
  createStudent,
  hostelService,
  studentService,
  feeService,
  allocationService,
  eligibilityService,
  settingsService,
  matching,
} from './helpers.js';

function buildHostels(actors) {
  const boys = hostelService.createHostel(
    { name: 'Boys Hall', gender: 'Male', category: 'Form 1', totalRooms: 2, totalBeds: 4, roomsPerFloor: 2 },
    actors.admin,
  );
  const girls = hostelService.createHostel(
    { name: 'Girls Hall', gender: 'Female', category: 'ALL', totalRooms: 2, totalBeds: 4, roomsPerFloor: 2 },
    actors.admin,
  );
  return { boys, girls };
}

test('the first deposit is required before allocation', () => {
  const actors = freshSetup();
  buildHostels(actors);

  const student = createStudent(actors, 'FEE-1', { gender: 'Male', yearForm: 'Form 1' });

  const summary = feeService.getFeeSummary(student.id);
  assert.equal(summary.required, 50000);
  assert.equal(summary.meetsRequirement, false);

  assert.throws(
    () => allocationService.autoAllocate(student.id, actors.warden),
    (error) => error.code === 'NOT_ELIGIBLE' && /deposit/i.test(error.message),
  );

  feeService.recordPayment(
    { studentIdentifier: student.id, amount: 30000, feeType: 'first_deposit', method: 'Mobile money' },
    actors.clerk,
  );
  assert.equal(feeService.getFeeSummary(student.id).meetsRequirement, false);

  feeService.recordPayment(
    { studentIdentifier: student.id, amount: 20000, feeType: 'balance', method: 'Cash' },
    actors.clerk,
  );
  assert.equal(feeService.getFeeSummary(student.id).meetsRequirement, true);

  const allocation = allocationService.autoAllocate(student.id, actors.warden);
  assert.equal(allocation.status, 'assigned');

  const assessment = eligibilityService.assessStudent(student.id);
  assert.equal(assessment.eligible, true);
});

test('the fee threshold is driven by the settings value', () => {
  const actors = freshSetup();
  buildHostels(actors);
  settingsService.setSetting('first_deposit_amount', '10000', { actor: actors.admin });

  const student = createStudent(actors, 'FEE-2', { gender: 'Male', yearForm: 'Form 1', pay: 10000 });
  assert.equal(feeService.getFeeSummary(student.id).meetsRequirement, true);
  assert.doesNotThrow(() => allocationService.autoAllocate(student.id, actors.warden));
});

test('gender and year/form rules are enforced', () => {
  const actors = freshSetup();
  const { boys, girls } = buildHostels(actors);

  const female = createStudent(actors, 'G-1', { gender: 'Female', yearForm: 'Form 1', pay: 50000 });

  const girlsBed = hostelService.listFreeBeds({ hostelId: girls.id })[0];
  assert.equal(allocationService.validatePlacement(female.id, girlsBed.bed_id).ok, true);

  const boysBed = hostelService.listFreeBeds({ hostelId: boys.id })[0];
  const genderCheck = allocationService.validatePlacement(female.id, boysBed.bed_id);
  assert.equal(genderCheck.ok, false);
  assert.match(genderCheck.reasons.join(' '), /male hostel/i);

  const senior = createStudent(actors, 'G-2', { gender: 'Male', yearForm: 'Year 2', pay: 50000 });
  const yearCheck = matching.hostelAcceptsStudent(boys, studentService.resolveStudent(senior.id));
  assert.equal(yearCheck.ok, false);
  assert.match(yearCheck.reasons.join(' '), /Form 1/);
});

test('required health conditions restrict which beds are eligible', () => {
  const actors = freshSetup();
  const { girls } = buildHostels(actors);

  hostelService.addRoom(
    { hostelId: girls.id, roomNumber: 'G1', floor: 0, capacity: 1, amenities: 'WHEELCHAIR_ACCESS,NEAR_BATHROOM' },
    actors.admin,
  );

  const student = createStudent(actors, 'H-1', { gender: 'Female', yearForm: 'Year 1', pay: 60000 });
  studentService.addHealthCondition(
    { studentIdentifier: student.id, code: 'WHEELCHAIR_ACCESS', level: 'required', notes: 'Private detail.' },
    actors.clerk,
  );

  const allocation = allocationService.autoAllocate(student.id, actors.warden);
  assert.equal(allocation.room_number, 'G1');
  assert.equal(hostelService.getBed(allocation.bed_id).floor, 0);
});

test('allocation fails when no bed can satisfy a required condition', () => {
  const actors = freshSetup();
  buildHostels(actors); // the generated rooms have no FAN amenity

  const student = createStudent(actors, 'H-2', { gender: 'Male', yearForm: 'Form 1', pay: 50000 });
  studentService.addHealthCondition(
    { studentIdentifier: student.id, code: 'FAN_REQUIRED', level: 'required' },
    actors.clerk,
  );

  assert.throws(
    () => allocationService.autoAllocate(student.id, actors.warden),
    (error) => error.code === 'NOT_ELIGIBLE',
  );

  studentService.removeHealthCondition(
    studentService.getRequirements(student.id)[0].id,
    actors.clerk,
  );
  studentService.addHealthCondition(
    { studentIdentifier: student.id, code: 'FAN_REQUIRED', level: 'preferred' },
    actors.clerk,
  );
  assert.doesNotThrow(() => allocationService.autoAllocate(student.id, actors.warden));
});
