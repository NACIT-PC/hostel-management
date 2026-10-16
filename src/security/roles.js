export const ROLE_NAMES = {
  admin: 'Administrator',
  warden: 'Warden',
  clerk: 'Clerk / Front desk',
};

export const ROLE_PERMISSIONS = {
  admin: [
    'hostel.manage',
    'room.manage',
    'student.manage',
    'fee.manage',
    'allocation.manage',
    'stay.manage',
    'report.view',
    'user.manage',
    'settings.manage',
    'health.reveal',
    'audit.view',
  ],
  warden: [
    'hostel.manage',
    'room.manage',
    'student.manage',
    'fee.manage',
    'allocation.manage',
    'stay.manage',
    'report.view',
    'health.reveal',
  ],
  clerk: [
    'student.manage',
    'fee.manage',
    'allocation.manage',
    'stay.manage',
    'report.view',
  ],
};
