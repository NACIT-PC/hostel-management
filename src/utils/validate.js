/**
 * Input validation helpers.
 *
 * Every helper either returns a clean, normalised value or throws a
 * ValidationError with a human readable message. Services use these so the
 * CLI, the command-line flags and the tests all get identical rules.
 */
import { ValidationError } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function asText(value, field, { min = 1, max = 200, optional = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw new ValidationError(`${field} is required.`);
  }
  const text = String(value).trim();
  if (text.length < min) throw new ValidationError(`${field} must be at least ${min} character(s).`);
  if (text.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
  return text;
}

/** Short uppercase-ish business key e.g. matric number `NACIT/2026/001`. */
export function asCode(value, field, { max = 40 } = {}) {
  const text = asText(value, field, { max });
  if (/\s/.test(text)) throw new ValidationError(`${field} must not contain spaces.`);
  return text;
}

export function asInteger(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ValidationError(`${field} is required.`);
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) throw new ValidationError(`${field} must be a whole number (got "${text}").`);
  const parsed = Number.parseInt(text, 10);
  if (parsed < min) throw new ValidationError(`${field} must be at least ${min}.`);
  if (parsed > max) throw new ValidationError(`${field} must be at most ${max}.`);
  return parsed;
}

export function asAmount(value, field, { min = 0.01, max = 100_000_000 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ValidationError(`${field} is required.`);
  }
  const text = String(value).trim().replace(/[,\s]/g, '');
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new ValidationError(`${field} must be a number (got "${value}").`);
  const rounded = Math.round(parsed * 100) / 100;
  if (rounded < min) throw new ValidationError(`${field} must be at least ${min}.`);
  if (rounded > max) throw new ValidationError(`${field} must be at most ${max}.`);
  return rounded;
}

export function asOneOf(value, allowed, field, { caseSensitive = false } = {}) {
  if (value === undefined || value === null) {
    throw new ValidationError(`${field} is required. Allowed: ${allowed.join(', ')}.`);
  }
  const raw = String(value).trim();
  const match = allowed.find((option) =>
    caseSensitive ? option === raw : option.toLowerCase() === raw.toLowerCase(),
  );
  if (!match) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}.`);
  return match;
}

export function asBoolean(value, field, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new ValidationError(`${field} is required (yes/no).`);
  }
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(raw)) return true;
  if (['n', 'no', 'false', '0'].includes(raw)) return false;
  throw new ValidationError(`${field} must be yes or no.`);
}

export function asEmail(value, field = 'Email', { optional = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw new ValidationError(`${field} is required.`);
  }
  const text = String(value).trim();
  if (!EMAIL_RE.test(text)) throw new ValidationError(`${field} is not a valid email address.`);
  return text.toLowerCase();
}

export function asPhone(value, field = 'Phone', { optional = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw new ValidationError(`${field} is required.`);
  }
  const text = String(value).trim();
  if (!PHONE_RE.test(text)) throw new ValidationError(`${field} is not a valid phone number.`);
  return text;
}

export function asDate(value, field = 'Date', { optional = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw new ValidationError(`${field} is required (YYYY-MM-DD).`);
  }
  const text = String(value).trim();
  if (!DATE_RE.test(text)) throw new ValidationError(`${field} must use the YYYY-MM-DD format.`);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${field} is not a real calendar date.`);
  return text;
}

export function asPassword(value, field = 'Password') {
  const text = asText(value, field, { min: 8, max: 128 });
  if (text.length < 8) throw new ValidationError(`${field} must be at least 8 characters long.`);
  return text;
}

/** Conference of amenities: "FAN, QUIET" -> "FAN,QUIET" with validated members. */
export function asAmenities(value, allowed, field = 'Amenities') {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const parts = String(value)
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  const unknown = parts.filter((part) => !allowed.includes(part));
  if (unknown.length) {
    throw new ValidationError(`${field}: unknown value(s) ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`);
  }
  return [...new Set(parts)].join(',');
}

export const isYes = (value) => asBoolean(value, 'Answer');
