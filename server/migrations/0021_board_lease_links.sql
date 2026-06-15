CREATE TABLE IF NOT EXISTS board_lease_links (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  session_id TEXT,
  run_id TEXT,
  lease_id TEXT,
  role TEXT NOT NULL DEFAULT 'primary',
  source TEXT NOT NULL DEFAULT 'manual_attach',
  status TEXT NOT NULL DEFAULT 'attached',
  attached_by TEXT NOT NULL,
  attached_at INTEGER NOT NULL,
  detached_at INTEGER,
  FOREIGN KEY (card_id) REFERENCES cards(id),
  FOREIGN KEY (session_id) REFERENCES interactive_sessions(id),
  FOREIGN KEY (run_id) REFERENCES run_attempts(id)
);

CREATE INDEX IF NOT EXISTS idx_board_lease_links_card
  ON board_lease_links(card_id, status, attached_at);

CREATE INDEX IF NOT EXISTS idx_board_lease_links_session
  ON board_lease_links(session_id, status, attached_at);

CREATE INDEX IF NOT EXISTS idx_board_lease_links_lease
  ON board_lease_links(lease_id, status);

CREATE INDEX IF NOT EXISTS idx_board_lease_links_run
  ON board_lease_links(run_id, status, attached_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_board_lease_links_active_card_session
  ON board_lease_links(card_id, session_id)
  WHERE status = 'attached' AND session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_board_lease_links_active_card_lease
  ON board_lease_links(card_id, lease_id)
  WHERE status = 'attached' AND lease_id IS NOT NULL;
