-- Backs SessionControlDO with sqlite so credential policies and checkpoints
-- survive a restart. Plain key/value, values are JSON. Keys match the old
-- in-memory map (sandbox:<id>, checkpoint:<session>:<id>, checkpoints:<session>).
CREATE TABLE IF NOT EXISTS session_control_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
