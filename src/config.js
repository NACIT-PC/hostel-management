import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DB_PATH = process.env.HOSTEL_DB_PATH
  ? path.resolve(process.env.HOSTEL_DB_PATH)
  : path.join(ROOT_DIR, 'data', 'hostel.db');

export const SCHEMA_PATH = path.join(ROOT_DIR, 'src', 'db', 'schema.sql');

export const APP_NAME = 'Hostel Bed Allocation System';
export const APP_VERSION = '1.0.0';

export const DEFAULT_ADMIN = {
  username: 'hostel-management@gmail.com',
  password: '12345678',
  fullName: 'Hostel Administrator',
};

export const GENDERS = ['Male', 'Female'];

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
    value: 'MWK',
    label: 'Currency label used when printing amounts',
  },
];

export const LIMITS = {
  MAX_BEDS_PER_ROOM: 12,
  MAX_ROOMS_PER_HOSTEL: 500,
  MIN_PASSWORD_LENGTH: 8,
  DEFAULT_ROOMS_PER_FLOOR: 10,
  TABLE_WIDTH: 100,
  SEARCH_LIMIT: 200,
};
