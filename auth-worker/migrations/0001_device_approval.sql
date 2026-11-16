-- AXIVESTRA device-level owner approval.
-- Better Auth core tables (user/session/account/verification) are generated separately
-- with: npx auth@latest generate --adapter kysely

CREATE TABLE IF NOT EXISTS device_access (
  id TEXT PRIMARY KEY,
  device_hash TEXT NOT NULL UNIQUE,
  user_id TEXT,
  email TEXT,
  device_label TEXT NOT NULL DEFAULT 'Unidentified device',
  device_kind TEXT NOT NULL DEFAULT 'browser' CHECK (device_kind IN ('browser', 'desktop', 'mobile', 'guest')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  approved_by TEXT,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_access_status_created
  ON device_access(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_access_user
  ON device_access(user_id, status);
CREATE INDEX IF NOT EXISTS idx_device_access_email
  ON device_access(email, status);

CREATE TABLE IF NOT EXISTS access_audit (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('device_registered', 'device_approved', 'device_rejected', 'device_revoked')),
  device_record_id TEXT NOT NULL,
  target_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_access_audit_created ON access_audit(created_at DESC);
