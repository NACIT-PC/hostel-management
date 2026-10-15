/**
 * Global configuration and domain constants for the Hostel Bed Allocation System.
 *
 * Everything that defines "what the institute allows" lives here so that the
 * services, the CLI and the tests all agree on a single source of truth.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path of the SQLite database file (override with HOSTEL_DB_PATH). */
export const DB_PATH = process.env.HOSTEL_DB_PATH
  ? path.resolve(process.env.HOSTEL_DB_PATH)
  : path.join(ROOT_DIR, 'data', 'hostel.db');

/** Absolute path of the SQL schema script. */
export const SCHEMA_PATH = path.join(ROOT_DIR, 'src', 'db', 'schema.sql');

export const APP_NAME = 'Hostel Bed Allocation System';
export const APP_VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Student / hostel taxonomies                                         */
/* ------------------------------------------------------------------ */

export const GENDERS = ['Male', 'Female'];

/** A hostel is either single-sex or (rarely) mixed. */
export const HOSTEL_GENDERS = ['Male', 'Female', 'Mixed'];

export const YEAR_FORMS = [
  'Form 1',
  'Form 2',
  'Form 3',
  'Form 4',
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Year 5',
];

/** `ALL` means the hostel accepts every year/form. */
export const ALL_YEARS = 'ALL';
export const HOSTEL_CATEGORIES = [ALL_YEARS, ...YEAR_FORMS];

export const ROOM_AMENITIES = [
  'FAN',
  'QUIET',
  'EN_SUITE',
  'NEAR_BATHROOM',
  'STUDY_DESK',
  'WINDOW',
  'WHEELCHAIR_ACCESS',
];

export const BUNK_LEVELS = ['LOWER', 'UPPER', 'SINGLE'];

export const FEE_TYPES = ['first_deposit', 'balance', 'other'];
export const PAYMENT_METHODS = ['Cash', 'Bank transfer', 'Mobile money', 'Cheque', 'Other'];

export const ALLOCATION_STATUSES = ['assigned', 'checked_in', 'checked_out', 'cancelled'];

/**
 * Health / sensitivity requirement codes.
 *
 * `enforceable` codes are matched against physical bed attributes so the
 * allocator can *guarantee* the accommodation suits the student. Codes with
 * `enforceable: false` are advisory only (they are still recorded privately).
 */
export const HEALTH_REQUIREMENT_CODES = [
  {
    code: 'GROUND_FLOOR',
    label: 'Requires ground-floor room (mobility / stairs)',
    enforceable: true,
  },
  { code: 'LOWER_BUNK', label: 'Requires lower bunk (mobility / injury)', enforceable: true },
  { code: 'QUIET_ROOM', label: 'Requires quiet room (migraine / mental health)', enforceable: true },
  { code: 'FAN_REQUIRED', label: 'Requires fan (heat / respiratory sensitivity)', enforceable: true },
  { code: 'EN_SUITE', label: 'Requires en-suite bathroom (medical)', enforceable: true },
  { code: 'NEAR_BATHROOM', label: 'Requires room near bathroom (medical)', enforceable: true },
  { code: 'WHEELCHAIR_ACCESS', label: 'Requires wheelchair-accessible room', enforceable: true },
  { code: 'SINGLE_ROOM', label: 'Requires single-occupancy room (medical)', enforceable: true },
  { code: 'OTHER', label: 'Other condition - see private notes', enforceable: false },
];

export const HEALTH_REQUIREMENT_LEVELS = ['required', 'preferred'];

export const HEALTH_REQUIREMENT_BY_CODE = new Map(
  HEALTH_REQUIREMENT_CODES.map((entry) => [entry.code, entry]),
);

/* ------------------------------------------------------------------ */
/* Settings (stored in the `settings` table, editable from the CLI)     */
/* ------------------------------------------------------------------ */

export const SETTING_KEYS = {
  INSTITUTION_NAME: 'institution_name',
  FIRST_DEPOSIT_AMOUNT: 'first_deposit_amount',
  CURRENCY: 'currency',
};

export const DEFAULT_SETTINGS = [
  {
    key: SETTING_KEYS.INSTITUTION_NAME,
    value: 'NACIT Institute',
    label: 'Name printed on reports',
  },
  {
    key: SETTING_KEYS.FIRST_DEPOSIT_AMOUNT,
    value: '50000',
    label: 'Minimum total fee deposit required before a student becomes eligible for allocation',
  },
  {
    key: SETTING_KEYS.CURRENCY,
    value: 'TZS',
    label: 'Currency label used when printing amounts',
  },
];

/* ------------------------------------------------------------------ */
/* Consistency guards                                                  */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  MAX_BEDS_PER_ROOM: 12,
  MAX_ROOMS_PER_HOSTEL: 500,
  MIN_PASSWORD_LENGTH: 8,
  DEFAULT_ROOMS_PER_FLOOR: 10,
  TABLE_WIDTH: 100,
  SEARCH_LIMIT: 200,
};
