ALTER TABLE interactive_sessions
  ADD COLUMN attention_state TEXT NOT NULL DEFAULT '';

ALTER TABLE interactive_sessions
  ADD COLUMN attention_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE interactive_sessions
  ADD COLUMN attention_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_interactive_sessions_attention
  ON interactive_sessions(attention_state, attention_at);
