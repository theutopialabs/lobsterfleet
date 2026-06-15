CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allow_entries (
  value TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'maintainer',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  repo TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  subject TEXT PRIMARY KEY,
  login TEXT,
  email TEXT,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  allowed INTEGER NOT NULL DEFAULT 0,
  teams TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subject) REFERENCES users(subject)
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  repo TEXT NOT NULL,
  source TEXT NOT NULL,
  runtime TEXT NOT NULL,
  policy TEXT NOT NULL,
  lane TEXT NOT NULL,
  owner TEXT NOT NULL,
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_event TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('org', 'Lobsterfleet OS'),
  ('github_org', ''),
  ('cap', '20'),
  ('retention', '30'),
  ('merge', 'guarded');
