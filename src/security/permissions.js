import { ROLE_NAMES, ROLE_PERMISSIONS } from './roles.js';
import { PermissionError } from '../utils/errors.js';

export { ROLE_NAMES, ROLE_PERMISSIONS };

export const PERMISSIONS = {
  HOSTEL_MANAGE: 'hostel.manage',
  ROOM_MANAGE: 'room.manage',
  STUDENT_MANAGE: 'student.manage',
  FEE_MANAGE: 'fee.manage',
  ALLOCATION_MANAGE: 'allocation.manage',
  STAY_MANAGE: 'stay.manage',
  REPORT_VIEW: 'report.view',
  USER_MANAGE: 'user.manage',
  SETTINGS_MANAGE: 'settings.manage',
  HEALTH_REVEAL: 'health.reveal',
  AUDIT_VIEW: 'audit.view',
};

export function can(role, permission) {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function assertPermission(actor, permission) {
  if (!actor) throw new PermissionError('You must be signed in to perform this action.');
  const required = Array.isArray(permission) ? permission : [permission];
  const missing = required.filter((item) => !can(actor.role, item));
  if (missing.length) {
    throw new PermissionError(
      `Role "${actor.role}" is not allowed to perform: ${missing.join(', ')}.`,
    );
  }
  return true;
}

export function describePermissions(role) {
  const labels = {
    [PERMISSIONS.HOSTEL_MANAGE]: 'register / edit hostels',
    [PERMISSIONS.ROOM_MANAGE]: 'manage rooms and beds',
    [PERMISSIONS.STUDENT_MANAGE]: 'register / edit students',
    [PERMISSIONS.FEE_MANAGE]: 'record fee deposits',
    [PERMISSIONS.ALLOCATION_MANAGE]: 'assign students to beds',
    [PERMISSIONS.STAY_MANAGE]: 'check students in and out',
    [PERMISSIONS.REPORT_VIEW]: 'view availability and reports',
    [PERMISSIONS.USER_MANAGE]: 'manage system users',
    [PERMISSIONS.SETTINGS_MANAGE]: 'change system settings',
    [PERMISSIONS.HEALTH_REVEAL]: 'reveal private health details',
    [PERMISSIONS.AUDIT_VIEW]: 'read the audit trail',
  };
  return (ROLE_PERMISSIONS[role] ?? []).map((permission) => labels[permission] ?? permission);
}
