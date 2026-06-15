ALTER TABLE interactive_sessions
  ADD COLUMN size TEXT NOT NULL DEFAULT '';

ALTER TABLE interactive_sessions
  ADD COLUMN region TEXT NOT NULL DEFAULT '';

ALTER TABLE interactive_sessions
  ADD COLUMN machine TEXT NOT NULL DEFAULT '';

ALTER TABLE interactive_sessions
  ADD COLUMN apt_upgrade INTEGER NOT NULL DEFAULT 0;
