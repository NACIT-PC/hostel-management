import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshSetup, authService, hostelService, security } from './helpers.js';

test('authentication verifies credentials and rejects bad passwords', () => {
  freshSetup();

  assert.equal(authService.authenticate('warden', 'wrong-password'), null);
  assert.equal(authService.authenticate('nobody', 'whatever'), null);

  const session = authService.authenticate('warden', 'WardenPass12');
  assert.equal(session.role, 'warden');
  assert.equal(session.username, 'warden');
  assert.equal('password_hash' in session, false);
});

test('role permissions gate privileged actions', () => {
  const actors = freshSetup();

  assert.equal(security.can('clerk', security.PERMISSIONS.HOSTEL_MANAGE), false);
  assert.equal(security.can('clerk', security.PERMISSIONS.AUDIT_VIEW), false);
  assert.throws(
    () =>
      hostelService.createHostel(
        { name: 'Not Allowed', gender: 'Male', category: 'ALL', totalRooms: 1, totalBeds: 1 },
        actors.clerk,
      ),
    (error) => error.code === 'PERMISSION_DENIED',
  );

  assert.doesNotThrow(() =>
    hostelService.createHostel(
      { name: 'Allowed Hall', gender: 'Male', category: 'ALL', totalRooms: 1, totalBeds: 1 },
      actors.warden,
    ),
  );
  assert.equal(security.can('warden', security.PERMISSIONS.AUDIT_VIEW), false);
  assert.equal(security.can('admin', security.PERMISSIONS.AUDIT_VIEW), true);
});

test('unauthenticated actors are rejected', () => {
  freshSetup();
  assert.throws(
    () => hostelService.createHostel({ name: 'Ghost Hall', gender: 'Male', totalRooms: 1, totalBeds: 1 }, null),
    (error) => error.code === 'PERMISSION_DENIED',
  );
});

test('a deactivated account cannot sign in', () => {
  const actors = freshSetup();
  const warden = authService.getByUsername('warden');
  authService.setActive(warden.id, false, actors.admin);

  assert.throws(
    () => authService.authenticate('warden', 'WardenPass12'),
    (error) => error.code === 'PERMISSION_DENIED',
  );
});
