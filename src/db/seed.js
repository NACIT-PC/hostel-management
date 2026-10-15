/**
 * Database initialisation + demo data seeding.
 *
 * `init`  -> schema + default settings only.
 * `seed`  -> schema + demo users/hostels/rooms/students/fees/allocations so the
 *            CLI can be explored immediately.
 */
import { initDatabase, transact } from './connection.js';
import { createUser, countUsers } from '../services/authService.js';
import { createHostel, addRoom, listFreeBeds } from '../services/hostelService.js';
import { registerStudent, addHealthCondition, setHealthNotes } from '../services/studentService.js';
import { recordPayment } from '../services/feeService.js';
import { autoAllocate } from '../services/allocationService.js';
import { checkIn } from '../services/stayService.js';
import { generatePassword } from '../security/password.js';
import { setSetting } from '../services/settingsService.js';
import { SETTING_KEYS } from '../config.js';

export function initialise({ force = false } = {}) {
  const db = initDatabase({ force });
  return db;
}

/**
 * Seed demo data.
 * @param {{ adminPassword?: string, password?: string }} options
 * @returns {{ adminPassword: string, users: object[], hostels: number, students: number }}
 */
export function seedDemoData({ adminPassword = null, wardenPassword = null, clerkPassword = null } = {}) {
  initDatabase();
  const adminPass = adminPassword || generatePassword(12);
  const wardenPass = wardenPassword || generatePassword(12);
  const clerkPass = clerkPassword || generatePassword(12);

  const existing = countUsers();
  if (existing > 0) {
    return { skipped: true, message: `Database already has ${existing} user account(s); seeding skipped.` };
  }

  const created = { users: [], hostels: [], students: [] };

  transact(() => {
    // --- Users ---------------------------------------------------------
    const admin = createUser(
      { username: 'admin', fullName: 'System Administrator', password: adminPass, role: 'admin' },
      null,
    );
    const warden = createUser(
      { username: 'warden', fullName: 'Hostel Warden', password: wardenPass, role: 'warden' },
      { id: admin.id, username: admin.username, role: 'admin' },
    );
    const clerk = createUser(
      { username: 'clerk', fullName: 'Front Desk Clerk', password: clerkPass, role: 'clerk' },
      { id: admin.id, username: admin.username, role: 'admin' },
    );
    created.users.push(
      { ...admin, password: adminPass },
      { ...warden, password: wardenPass },
      { ...clerk, password: clerkPass },
    );

    const actor = { id: admin.id, username: admin.username, role: admin.role };

    // --- Hostels -------------------------------------------------------
    const mwembe = createHostel(
      {
        name: 'Mwembe',
        gender: 'Male',
        category: 'Form 1',
        totalRooms: 4,
        totalBeds: 12,
        roomsPerFloor: 2,
        description: 'Junior boys hostel, two blocks per floor',
      },
      actor,
    );
    const mkuyu = createHostel(
      {
        name: 'Mkuyu',
        gender: 'Male',
        category: 'ALL',
        totalRooms: 3,
        totalBeds: 6,
        roomsPerFloor: 3,
        description: 'Senior boys hostel',
      },
      actor,
    );
    const jacaranda = createHostel(
      {
        name: 'Jacaranda',
        gender: 'Female',
        category: 'ALL',
        totalRooms: 4,
        totalBeds: 10,
        roomsPerFloor: 2,
        description: 'Girls hostel with ground-floor accessible rooms',
      },
      actor,
    );
    created.hostels.push(mwembe, mkuyu, jacaranda);

    // Ground-floor accessible room for a mobility-impaired student.
    addRoom(
      { hostelId: jacaranda.id, roomNumber: 'G1', floor: 0, capacity: 2, amenities: 'WHEELCHAIR_ACCESS,NEAR_BATHROOM,QUIET' },
      actor,
    );
    // A quiet room with a fan for respiratory needs.
    addRoom(
      { hostelId: mkuyu.id, roomNumber: 'S1', floor: 0, capacity: 2, amenities: 'FAN,QUIET,STUDY_DESK' },
      actor,
    );

    // --- Students ------------------------------------------------------
    const studentSeed = [
      { studentCode: 'NACIT/2026/001', fullName: 'Amina Hassan', gender: 'Female', yearForm: 'Year 1', phone: '0712000001' },
      { studentCode: 'NACIT/2026/002', fullName: 'Grace Mwangi', gender: 'Female', yearForm: 'Year 1', phone: '0712000002' },
      { studentCode: 'NACIT/2026/003', fullName: 'Neema Joseph', gender: 'Female', yearForm: 'Form 3', phone: '0712000003' },
      { studentCode: 'NACIT/2026/004', fullName: 'John Mushi', gender: 'Male', yearForm: 'Form 1', phone: '0712000004' },
      { studentCode: 'NACIT/2026/005', fullName: 'Peter Kimaro', gender: 'Male', yearForm: 'Year 2', phone: '0712000005' },
      { studentCode: 'NACIT/2026/006', fullName: 'Samuel Otieno', gender: 'Male', yearForm: 'Year 2', phone: '0712000006' },
      { studentCode: 'NACIT/2026/007', fullName: 'Fatma Ally', gender: 'Female', yearForm: 'Year 3', phone: '0712000007' },
      { studentCode: 'NACIT/2026/008', fullName: 'Brian Mtei', gender: 'Male', yearForm: 'Form 1', phone: '0712000008' },
    ];

    for (const record of studentSeed) {
      created.students.push(registerStudent(record, actor));
    }

    // Private health information (never printed without permission).
    const amina = created.students[0];
    addHealthCondition(
      { studentIdentifier: amina.id, code: 'GROUND_FLOOR', level: 'required', notes: 'Uses crutches; cannot climb stairs.' },
      actor,
    );
    setHealthNotes(amina.id, 'Mobility impairment (left leg). Contact guardian on file.', actor);

    const grace = created.students[1];
    addHealthCondition(
      { studentIdentifier: grace.id, code: 'FAN_REQUIRED', level: 'preferred', notes: 'Asthma - heat makes breathing worse.' },
      actor,
    );
    setHealthNotes(grace.id, 'Mild asthma.', actor);

    const samuel = created.students[5];
    addHealthCondition(
      { studentIdentifier: samuel.id, code: 'LOWER_BUNK', level: 'required', notes: 'Recent knee surgery.' },
      actor,
    );

    // --- Fees ----------------------------------------------------------
    const feePlan = [
      [created.students[0], 60000, 'first_deposit'],
      [created.students[1], 50000, 'first_deposit'],
      [created.students[2], 20000, 'first_deposit'],
      [created.students[3], 50000, 'first_deposit'],
      [created.students[4], 50000, 'first_deposit'],
      [created.students[5], 50000, 'first_deposit'],
      [created.students[6], 0, null],
    ];
    for (const [student, amount, feeType] of feePlan) {
      if (!amount) continue;
      recordPayment(
        { studentIdentifier: student.id, amount, feeType, method: 'Bank transfer', reference: `RCPT-${student.id}` },
        clerk,
      );
    }
    // Top-up balance for one student.
    recordPayment(
      { studentIdentifier: created.students[0].id, amount: 40000, feeType: 'balance', method: 'Mobile money', reference: 'RCPT-BAL-1' },
      clerk,
    );

    // --- Allocations ---------------------------------------------------
    // Amina needs ground floor -> auto allocator must place her in G1.
    const aminaAllocation = autoAllocate(created.students[0].id, warden);
    checkIn(aminaAllocation.id, warden);

    const samuelAllocation = autoAllocate(created.students[5].id, warden);
    checkIn(samuelAllocation.id, warden);

    autoAllocate(created.students[1].id, warden);
    autoAllocate(created.students[3].id, warden);
    autoAllocate(created.students[4].id, warden);

    // --- Policy --------------------------------------------------------
    setSetting(SETTING_KEYS.FIRST_DEPOSIT_AMOUNT, '50000', { actor });
    setSetting(SETTING_KEYS.INSTITUTION_NAME, 'NACIT Institute', { actor });
  });

  return {
    skipped: false,
    users: created.users,
    hostels: created.hostels.length,
    students: created.students.length,
    freeBeds: listFreeBeds().length,
  };
}
