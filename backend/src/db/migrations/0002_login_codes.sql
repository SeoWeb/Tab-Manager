CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 1,
  first_request_at TEXT NOT NULL,
  PRIMARY KEY (email)
);

CREATE INDEX IF NOT EXISTS idx_login_codes_expires
ON login_codes(expires_at);
