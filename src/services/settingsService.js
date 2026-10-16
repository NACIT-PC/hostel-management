import { getDb } from '../db/connection.js';
import { SETTING_KEYS, DEFAULT_SETTINGS } from '../config.js';
import { assertPermission, PERMISSIONS } from '../security/permissions.js';
import { log as auditLog } from './auditService.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { asText, asAmount } from '../utils/validate.js';

const DEFAULTS = new Map(DEFAULT_SETTINGS.map((entry) => [entry.key, entry.value]));

export function listSettings() {
  return getDb()
    .prepare('SELECT key, value, label, updated_at FROM settings ORDER BY key')
    .all();
}

export function getSetting(key, fallback = undefined) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  return fallback ?? DEFAULTS.get(key);
}

export function getNumberSetting(key, fallback = 0) {
  const value = Number(getSetting(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function getCurrency() {
  return getSetting(SETTING_KEYS.CURRENCY, 'MWK') || '';
}

export function getFirstDepositRequirement() {
  return getNumberSetting(SETTING_KEYS.FIRST_DEPOSIT_AMOUNT, 0);
}

export function getInstitutionName() {
  return getSetting(SETTING_KEYS.INSTITUTION_NAME, 'Hostel');
}

export function setSetting(key, value, { actor, label = null } = {}) {
  assertPermission(actor, PERMISSIONS.SETTINGS_MANAGE);
  const cleanKey = asText(key, 'Setting key', { max: 60 });
  let cleanValue;

  if (cleanKey === SETTING_KEYS.FIRST_DEPOSIT_AMOUNT) {
    cleanValue = String(asAmount(value, 'First deposit amount', { min: 0, max: 100_000_000 }));
  } else {
    cleanValue = asText(value, 'Setting value', { max: 200 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(cleanKey);
  if (!existing && !DEFAULTS.has(cleanKey)) {
    throw new NotFoundError(`Unknown setting "${cleanKey}".`);
  }

  db.prepare(
    `INSERT INTO settings (key, value, label, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                    label = COALESCE(excluded.label, settings.label),
                                    updated_at = datetime('now')`,
  ).run(cleanKey, cleanValue, label);

  auditLog({
    actor,
    action: 'setting.updated',
    entity: 'settings',
    detail: `${cleanKey} = ${cleanValue}`,
  });

  if (!cleanValue) throw new ValidationError('Setting value cannot be empty.');
  return { key: cleanKey, value: cleanValue };
}
