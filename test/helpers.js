import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostel-test-'));
process.env.HOSTEL_DB_PATH = path.join(tempDir, 'hostel.db');

const connection = await import('../src/db/connection.js');
const services = await import('../src/services/index.js');
const errors = await import('../src/utils/errors.js');
const config = await import('../src/config.js');
const matching = await import('../src/services/matching.js');
const security = await import('../src/security/permissions.js');

export { errors, config, matching, security, services };

export const {
  authService,
  auditService,
  hostelService,
  studentService,
  feeService,
  eligibilityService,
  allocationService,
  stayService,
  settingsService,
  reportService,
} = services;

export const { initDatabase, getDb, closeDatabase, transact } = connection;

export function resetDatabase() {
  initDatabase({ force: true });
}

export function makeActors() {
  const admin = authService.createUser({
    username: 'admin',
    fullName: 'System Administrator',
    password: 'AdminPass123',
    role: 'admin',
  });
  const warden = authService.createUser(
    { username: 'warden', fullName: 'Hostel Warden', password: 'WardenPass12', role: 'warden' },
    admin,
  );
  const clerk = authService.createUser(
    { username: 'clerk', fullName: 'Front Desk Clerk', password: 'ClerkPass123', role: 'clerk' },
    admin,
  );

  return {
    admin: { id: admin.id, username: admin.username, role: admin.role },
    warden: { id: warden.id, username: warden.username, role: warden.role },
    clerk: { id: clerk.id, username: clerk.username, role: clerk.role },
  };
}

export function freshSetup() {
  resetDatabase();
  return makeActors();
}

export function createStudent(actors, code, overrides = {}) {
  const { pay = null, ...rest } = overrides;
  const student = studentService.registerStudent(
    {
      studentCode: code,
      fullName: `Test Student ${code}`,
      gender: 'Male',
      yearForm: 'Year 1',
      ...rest,
    },
    actors.clerk,
  );
  if (pay !== null && pay !== undefined) {
    feeService.recordPayment(
      { studentIdentifier: student.id, amount: pay, feeType: 'first_deposit', method: 'Cash' },
      actors.clerk,
    );
  }
  return student;
}
