import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH, SCHEMA_PATH, DEFAULT_SETTINGS } from '../config.js';

let connection = null;

export function databaseExists() {
  return fs.existsSync(DB_PATH);
}

export function getDb() {
  if (connection) return connection;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  connection = new Database(DB_PATH);
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');
  return connection;
}

function seedDefaultSettings(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, label) VALUES (?, ?, ?)',
  );
  for (const setting of DEFAULT_SETTINGS) {
    insert.run(setting.key, setting.value, setting.label);
  }
}

export function initDatabase({ force = false } = {}) {
  if (force) removeDatabaseFiles();
  const db = getDb();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  seedDefaultSettings(db);
  return db;
}

export function ensureDatabase() {
  const db = getDb();
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (count === 0) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    seedDefaultSettings(db);
    return { created: true, db };
  }
  seedDefaultSettings(db);
  return { created: false, db };
}

export function closeDatabase() {
  if (connection) {
    connection.close();
    connection = null;
  }
}

export function removeDatabaseFiles() {
  closeDatabase();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
}

export function transact(fn) {
  return getDb().transaction(fn)();
}

export function scalar(sql, ...params) {
  const row = getDb().prepare(sql).get(...params);
  if (!row) return undefined;
  return Object.values(row)[0];
}
