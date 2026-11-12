-- Vacancy Tracker — PostgreSQL schema.
-- Firebase Authentication holds ONLY the generated login (username + password hash).
-- Everything below is application data. Data rows are keyed by uid and do NOT require an
-- accounts row, so existing users' data can be imported before they claim a username. user_id / owner_uid = the Firebase Auth uid,
-- which is the stable internal key; the @vecancy.tracker username is a login label only.

CREATE TABLE IF NOT EXISTS accounts (
  user_id               TEXT PRIMARY KEY,
  username              TEXT NOT NULL,
  username_lower        TEXT NOT NULL UNIQUE,          -- case-insensitive uniqueness
  original_email        TEXT NOT NULL,
  original_email_lower  TEXT NOT NULL UNIQUE,          -- one account per verified email
  verified_via          TEXT NOT NULL,                 -- google.com | email-link
  display_name          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  password_changed_at   TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ
);

-- ---------------------------------------------------------------- per-admin data
CREATE TABLE IF NOT EXISTS rooms (
  owner_uid TEXT NOT NULL,
  id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  room TEXT, type TEXT, gender TEXT, ac JSONB, demographic TEXT, tenancy_mode TEXT,
  capacity INTEGER, x DOUBLE PRECISION, y DOUBLE PRECISION,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);
CREATE TABLE IF NOT EXISTS beds (
  owner_uid TEXT NOT NULL, room_id TEXT NOT NULL, position INTEGER NOT NULL,
  slot TEXT, tenant TEXT, bed_start TEXT, bed_end TEXT, reserved_for TEXT,
  resident_type TEXT, resident_gender TEXT, temporary_client_id TEXT,
  extra JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (owner_uid, room_id, position),
  FOREIGN KEY (owner_uid, room_id) REFERENCES rooms(owner_uid, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS beds_tenant_idx ON beds(owner_uid, tenant);

CREATE TABLE IF NOT EXISTS shapes (
  owner_uid TEXT NOT NULL, id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  label TEXT, label_rotation DOUBLE PRECISION, kind TEXT, geometry TEXT, color TEXT,
  x DOUBLE PRECISION, y DOUBLE PRECISION, width DOUBLE PRECISION, height DOUBLE PRECISION,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);
CREATE TABLE IF NOT EXISTS prospects (
  owner_uid TEXT NOT NULL, id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  name TEXT, gender TEXT, demographic TEXT, check_in TEXT, check_out TEXT, notes TEXT,
  reserved_bed JSONB, desired_bed JSONB,
  checked_in BOOLEAN, checked_in_at TIMESTAMPTZ, checked_out BOOLEAN, checked_out_at TIMESTAMPTZ,
  group_id TEXT, group_size INTEGER,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);
CREATE INDEX IF NOT EXISTS prospects_checkin_idx ON prospects(owner_uid, check_in);
CREATE TABLE IF NOT EXISTS temporary_clients (
  owner_uid TEXT NOT NULL, id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  name TEXT, gender TEXT, start_date TEXT, end_date TEXT, notes TEXT,
  room_id TEXT, room TEXT, slot TEXT, status TEXT,
  created_at_client TIMESTAMPTZ, checked_out_at TIMESTAMPTZ, remind_after BIGINT, transfer_to JSONB,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);
CREATE TABLE IF NOT EXISTS tenant_history (
  owner_uid TEXT NOT NULL, id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  tenant TEXT, room_id TEXT, room TEXT, slot TEXT, start_date TEXT, end_date TEXT,
  resident_type TEXT, resident_gender TEXT, reason TEXT,
  left_at TIMESTAMPTZ, expire_at TIMESTAMPTZ,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);
CREATE INDEX IF NOT EXISTS history_left_idx ON tenant_history(owner_uid, left_at DESC);
CREATE INDEX IF NOT EXISTS history_expire_idx ON tenant_history(owner_uid, expire_at);
CREATE TABLE IF NOT EXISTS bed_transfers (
  owner_uid TEXT NOT NULL, id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  tenant TEXT, from_loc JSONB, to_loc JSONB, resident_type TEXT, transferred_at TIMESTAMPTZ,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);
CREATE TABLE IF NOT EXISTS user_settings (
  owner_uid TEXT NOT NULL, id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  code TEXT, dorm_name TEXT, enabled BOOLEAN,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);

-- ---------------------------------------------------------------- account (data) transfer
CREATE TABLE IF NOT EXISTS account_transfers (
  code TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  from_uid TEXT, from_email TEXT, purpose TEXT, expires_at TIMESTAMPTZ, status TEXT,
  to_uid TEXT, to_email TEXT, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transfers_from_idx ON account_transfers(from_uid);
CREATE TABLE IF NOT EXISTS incoming_transfers (
  to_uid TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  code TEXT, from_uid TEXT, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- dorm viewer sharing
CREATE TABLE IF NOT EXISTS dorms (
  code TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  owner_uid TEXT, dorm_name TEXT, enabled BOOLEAN, updated_at_client TIMESTAMPTZ,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dorms_owner_idx ON dorms(owner_uid);
CREATE TABLE IF NOT EXISTS dorm_secrets (
  code TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  owner_uid TEXT, password_hash TEXT, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dorm_vacancy (
  code TEXT NOT NULL, id TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  room TEXT, gender TEXT, demographic TEXT, total INTEGER, vacant INTEGER, reserved INTEGER,
  x DOUBLE PRECISION, y DOUBLE PRECISION, beds JSONB, status TEXT, updated_at_client TIMESTAMPTZ,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, id)
);
CREATE TABLE IF NOT EXISTS dorm_layout (
  code TEXT NOT NULL, id TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  shapes JSONB, updated_at_client TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, id)
);
CREATE TABLE IF NOT EXISTS dorm_viewers (
  code TEXT NOT NULL, uid TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  proof TEXT, name TEXT, email TEXT, joined_at TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, uid)
);
CREATE TABLE IF NOT EXISTS dorm_blocked (
  code TEXT NOT NULL, uid TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  name TEXT, email TEXT, blocked_at TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, uid)
);

-- ---------------------------------------------------------------- Super Admin platform
CREATE TABLE IF NOT EXISTS super_admins (
  uid TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  email TEXT, created_at_client TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pairing (
  code TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  owner_uid TEXT, dorm_name TEXT, location TEXT, expires_at TIMESTAMPTZ,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS branches (
  uid TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  owner_uid TEXT, dorm_name TEXT, location TEXT, purpose TEXT, pairing_code TEXT,
  requested_by TEXT, dir_status TEXT, analytics_status TEXT,
  created_at_client TIMESTAMPTZ, decided_at TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS branches_requested_idx ON branches(requested_by);
CREATE TABLE IF NOT EXISTS branch_snapshots (
  branch_uid TEXT NOT NULL, id TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  total INTEGER, vacant INTEGER, occupied INTEGER, male_vacant INTEGER, female_vacant INTEGER,
  student_vacant INTEGER, reviewee_vacant INTEGER, mixed_vacant INTEGER, mixed_group_vacant INTEGER,
  ac_vacant INTEGER, non_ac_vacant INTEGER, checkouts JSONB, checkins JSONB,
  captured_at TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_uid, id)
);
CREATE INDEX IF NOT EXISTS snapshots_time_idx ON branch_snapshots(branch_uid, captured_at);
CREATE TABLE IF NOT EXISTS branch_changes (
  branch_uid TEXT NOT NULL, id TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  kind TEXT, status TEXT, dorm_name TEXT, created_at_client TIMESTAMPTZ, decided_at TIMESTAMPTZ,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_uid, id)
);
CREATE TABLE IF NOT EXISTS directory_entries (
  uid TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  owner_uid TEXT, dorm_name TEXT, location TEXT, total INTEGER, vacant INTEGER, occupied INTEGER,
  male_vacant INTEGER, female_vacant INTEGER, student_vacant INTEGER, reviewee_vacant INTEGER,
  mixed_vacant INTEGER, mixed_group_vacant INTEGER, ac_vacant INTEGER, non_ac_vacant INTEGER,
  updated_at_client TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  actor_uid TEXT, actor_email TEXT, action TEXT, branch TEXT, detail TEXT,
  at TIMESTAMPTZ, target_admin TEXT, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_target_idx ON audit_log(target_admin);

-- Marketing Viewer access to a Super Admin's central server
CREATE TABLE IF NOT EXISTS central_access (
  code TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  owner_uid TEXT, name TEXT, enabled BOOLEAN, updated_at_client TIMESTAMPTZ,
  extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS central_owner_idx ON central_access(owner_uid);
CREATE TABLE IF NOT EXISTS central_viewers (
  code TEXT NOT NULL, uid TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  proof TEXT, name TEXT, email TEXT, joined_at TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, uid)
);
CREATE TABLE IF NOT EXISTS central_blocked (
  code TEXT NOT NULL, uid TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  name TEXT, email TEXT, blocked_at TIMESTAMPTZ, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, uid)
);
CREATE TABLE IF NOT EXISTS central_owner (
  uid TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  code TEXT, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS central_secrets (
  code TEXT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1,
  owner_uid TEXT, password_hash TEXT, extra JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- AI persistent data
-- Conversation history, insights and per-user configuration. (The trained intent model
-- itself stays as code/model files; only the data it produces and uses is stored here.)
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  title TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conv_owner_idx ON ai_conversations(owner_uid, updated_at DESC);
CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  owner_uid TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL, intent TEXT, confidence DOUBLE PRECISION, scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_msg_conv_idx ON ai_messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS ai_insights (
  id BIGSERIAL PRIMARY KEY,
  owner_uid TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  kind TEXT NOT NULL, summary TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_insight_owner_idx ON ai_insights(owner_uid, generated_at DESC);
CREATE TABLE IF NOT EXISTS ai_config (
  owner_uid TEXT PRIMARY KEY REFERENCES accounts(user_id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
