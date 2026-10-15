/**
 * Password hashing using Node's built-in scrypt (no native dependency).
 *
 * Stored format:  scrypt$<salt-hex>$<hash-hex>
 * Verification is timing-safe.
 */
import crypto from 'node:crypto';
import { ValidationError } from '../utils/errors.js';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCHEME = 'scrypt';

export function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new ValidationError('Password must be a non-empty string.');
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = crypto.scryptSync(plain, salt, KEY_LENGTH).toString('hex');
  return `${SCHEME}$${salt}$${derived}`;
}

export function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== SCHEME || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(plain, salt, KEY_LENGTH);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/** Random readable password (useful when generating credentials). */
export function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
