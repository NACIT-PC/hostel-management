-- ============================================================================
--  Hostel Bed Allocation System - SQLite schema
--  Run via:  npm run init      (or)  node bin/hostel.js init
--
--  The script is idempotent: every object uses IF NOT EXISTS, so it can be
--  re-executed against an existing database without destroying data.
--  PRAGMA foreign_keys is a per-connection setting and is also enabled in
--  src/db/connection.js so that referential integrity is always enforced.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. System users (authentication / authorisation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'warden', 'clerk')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ---------------------------------------------------------------------------
-- 2. Configurable settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  label      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 3. Hostel inventory: hostels -> rooms -> beds
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hostels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  gender      TEXT    NOT NULL CHECK (gender IN ('Male', 'Female', 'Mixed')),
  category    TEXT    NOT NULL DEFAULT 'ALL',   -- 'ALL' or a year/form restriction
  total_rooms INTEGER NOT NULL DEFAULT 0 CHECK (total_rooms >= 0),
  total_beds  INTEGER NOT NULL DEFAULT 0 CHECK (total_beds >= 0),
  description TEXT,
  created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hostels_gender_category ON hostels (gender, category);

CREATE TABLE IF NOT EXISTS rooms (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hostel_id    INTEGER NOT NULL REFERENCES hostels (id) ON DELETE CASCADE,
  room_number  TEXT    NOT NULL,
  floor        INTEGER NOT NULL DEFAULT 0 CHECK (floor >= 0),
  capacity     INTEGER NOT NULL CHECK (capacity > 0),
  amenities    TEXT    NOT NULL DEFAULT '',     -- comma separated ROOM_AMENITIES
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (hostel_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_rooms_hostel ON rooms (hostel_id);

CREATE TABLE IF NOT EXISTS beds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id      INTEGER NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  bunk_level   TEXT    NOT NULL DEFAULT 'SINGLE' CHECK (bunk_level IN ('LOWER', 'UPPER', 'SINGLE')),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, label)
);

CREATE INDEX IF NOT EXISTS idx_beds_room ON beds (room_id);

-- ---------------------------------------------------------------------------
-- 4. Students & private health information
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_code TEXT   NOT NULL UNIQUE COLLATE NOCASE,   -- the "Student ID"
  full_name   TEXT    NOT NULL,
  gender      TEXT    NOT NULL CHECK (gender IN ('Male', 'Female')),
  year_form   TEXT    NOT NULL,
  phone       TEXT,
  email       TEXT,
  -- Free-text sensitive notes. Never printed unless the actor holds
  -- the `health.reveal` permission; every reveal is written to audit_log.
  health_notes TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_students_gender_year ON students (gender, year_form);
CREATE INDEX IF NOT EXISTS idx_students_name ON students (full_name);

CREATE TABLE IF NOT EXISTS student_health_conditions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  code        TEXT    NOT NULL,                 -- HEALTH_REQUIREMENT_CODES[].code
  level       TEXT    NOT NULL DEFAULT 'required' CHECK (level IN ('required', 'preferred')),
  notes       TEXT,                             -- private detail for this condition
  recorded_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, code)
);

CREATE INDEX IF NOT EXISTS idx_health_student ON student_health_conditions (student_id);

-- ---------------------------------------------------------------------------
-- 5. Fee payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fee_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  amount      REAL    NOT NULL CHECK (amount > 0),
  fee_type    TEXT    NOT NULL DEFAULT 'first_deposit'
              CHECK (fee_type IN ('first_deposit', 'balance', 'other')),
  method      TEXT    NOT NULL DEFAULT 'Cash',
  reference   TEXT,
  paid_on     TEXT    NOT NULL DEFAULT (date('now')),
  note        TEXT,
  recorded_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fee_payments_student ON fee_payments (student_id, paid_on);
CREATE INDEX IF NOT EXISTS idx_fee_payments_type ON fee_payments (fee_type);

-- ---------------------------------------------------------------------------
-- 6. Bed allocations (assignment + stay lifecycle)
--
--    status flow:  assigned -> checked_in -> checked_out
--                  assigned -> cancelled
--
--    The two partial unique indexes below are the last line of defence
--    against double-allocating a student or a bed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS allocations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  bed_id        INTEGER NOT NULL REFERENCES beds (id) ON DELETE RESTRICT,
  status        TEXT    NOT NULL DEFAULT 'assigned'
                CHECK (status IN ('assigned', 'checked_in', 'checked_out', 'cancelled')),
  assigned_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  assigned_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  checked_in_at TEXT,
  checked_out_at TEXT,
  cancelled_at  TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_allocations_active_student
  ON allocations (student_id) WHERE status IN ('assigned', 'checked_in');

CREATE UNIQUE INDEX IF NOT EXISTS ux_allocations_active_bed
  ON allocations (bed_id) WHERE status IN ('assigned', 'checked_in');

CREATE INDEX IF NOT EXISTS idx_allocations_status ON allocations (status);
CREATE INDEX IF NOT EXISTS idx_allocations_student ON allocations (student_id);
CREATE INDEX IF NOT EXISTS idx_allocations_bed ON allocations (bed_id);

-- ---------------------------------------------------------------------------
-- 7. Check-in / check-out movement log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stay_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  allocation_id INTEGER NOT NULL REFERENCES allocations (id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  bed_id        INTEGER NOT NULL REFERENCES beds (id) ON DELETE CASCADE,
  action        TEXT    NOT NULL CHECK (action IN ('checked_in', 'checked_out', 'cancelled')),
  actor_id      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  note          TEXT,
  at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stay_logs_allocation ON stay_logs (allocation_id);
CREATE INDEX IF NOT EXISTS idx_stay_logs_student ON stay_logs (student_id);
CREATE INDEX IF NOT EXISTS idx_stay_logs_at ON stay_logs (at);

-- ---------------------------------------------------------------------------
-- 8. Audit trail (authentication, data changes, privacy reveals)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  username   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  detail     TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id);

-- ---------------------------------------------------------------------------
-- 9. Reporting views (documentational / relational queries)
-- ---------------------------------------------------------------------------

-- One row per bed with its current occupant (if any).
CREATE VIEW IF NOT EXISTS v_bed_occupancy AS
SELECT
  b.id                    AS bed_id,
  b.label                 AS bed_label,
  b.bunk_level            AS bunk_level,
  b.is_available          AS bed_enabled,
  r.id                    AS room_id,
  r.room_number           AS room_number,
  r.floor                 AS floor,
  r.capacity              AS room_capacity,
  r.amenities             AS amenities,
  r.is_available          AS room_enabled,
  h.id                    AS hostel_id,
  h.name                  AS hostel_name,
  h.gender                AS hostel_gender,
  h.category              AS hostel_category,
  a.id                    AS allocation_id,
  a.status                AS allocation_status,
  a.checked_in_at         AS checked_in_at,
  s.id                    AS student_id,
  s.student_code          AS student_code,
  s.full_name             AS student_name,
  s.gender                AS student_gender,
  s.year_form             AS student_year_form,
  CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS is_occupied
FROM beds b
JOIN rooms r       ON r.id = b.room_id
JOIN hostels h     ON h.id = r.hostel_id
LEFT JOIN allocations a
       ON a.bed_id = b.id AND a.status IN ('assigned', 'checked_in')
LEFT JOIN students s ON s.id = a.student_id;

-- Occupancy roll-up per hostel.
CREATE VIEW IF NOT EXISTS v_hostel_occupancy AS
SELECT
  h.id                                                   AS hostel_id,
  h.name                                                 AS hostel_name,
  h.gender                                               AS gender,
  h.category                                             AS category,
  COUNT(DISTINCT r.id)                                   AS total_rooms,
  COUNT(b.id)                                            AS total_beds,
  COALESCE(SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS occupied_beds,
  COALESCE(SUM(CASE WHEN a.status = 'checked_in' THEN 1 ELSE 0 END), 0) AS checked_in_beds,
  COALESCE(SUM(CASE WHEN a.status = 'assigned' THEN 1 ELSE 0 END), 0)   AS reserved_beds,
  COUNT(b.id) - COALESCE(SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS free_beds
FROM hostels h
LEFT JOIN rooms r  ON r.hostel_id = h.id
LEFT JOIN beds b    ON b.room_id = r.id
LEFT JOIN allocations a
       ON a.bed_id = b.id AND a.status IN ('assigned', 'checked_in')
GROUP BY h.id;

-- Occupancy roll-up per room.
CREATE VIEW IF NOT EXISTS v_room_occupancy AS
SELECT
  r.id                                                    AS room_id,
  r.room_number                                           AS room_number,
  r.floor                                                 AS floor,
  r.capacity                                              AS capacity,
  r.amenities                                             AS amenities,
  r.is_available                                          AS room_enabled,
  h.id                                                    AS hostel_id,
  h.name                                                  AS hostel_name,
  h.gender                                                AS hostel_gender,
  COUNT(b.id)                                             AS total_beds,
  COALESCE(SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS occupied_beds,
  COUNT(b.id) - COALESCE(SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS free_beds
FROM rooms r
JOIN hostels h    ON h.id = r.hostel_id
LEFT JOIN beds b  ON b.room_id = r.id
LEFT JOIN allocations a
       ON a.bed_id = b.id AND a.status IN ('assigned', 'checked_in')
GROUP BY r.id;

-- Who is currently assigned/checked in, and exactly where.
CREATE VIEW IF NOT EXISTS v_current_residents AS
SELECT
  s.id            AS student_id,
  s.student_code  AS student_code,
  s.full_name     AS student_name,
  s.gender        AS student_gender,
  s.year_form     AS student_year_form,
  h.name          AS hostel_name,
  r.room_number   AS room_number,
  b.label         AS bed_label,
  a.id            AS allocation_id,
  a.status        AS allocation_status,
  a.assigned_at   AS assigned_at,
  a.checked_in_at AS checked_in_at
FROM allocations a
JOIN students s ON s.id = a.student_id
JOIN beds b     ON b.id = a.bed_id
JOIN rooms r    ON r.id = b.room_id
JOIN hostels h  ON h.id = r.hostel_id
WHERE a.status IN ('assigned', 'checked_in');

-- Fees roll-up per student.
CREATE VIEW IF NOT EXISTS v_student_fees AS
SELECT
  s.id                          AS student_id,
  s.student_code                AS student_code,
  s.full_name                   AS student_name,
  COALESCE(SUM(f.amount), 0)    AS total_paid,
  COUNT(f.id)                   AS payment_count,
  MIN(f.paid_on)                AS first_payment_on,
  MAX(f.paid_on)                AS last_payment_on
FROM students s
LEFT JOIN fee_payments f ON f.student_id = s.id
GROUP BY s.id;
