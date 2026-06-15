UPDATE settings
SET value = 'Lobsterfleet OS'
WHERE key = 'org' AND value = 'The Utopia Labs';

UPDATE settings
SET value = ''
WHERE key = 'github_org' AND value = 'theutopialabs';

DELETE FROM events
WHERE card_id IN ('CY-101', 'CY-102', 'CY-103');

DELETE FROM cards
WHERE id IN ('CY-101', 'CY-102', 'CY-103')
  AND owner = 'system';

INSERT OR IGNORE INTO repos (repo, enabled, created_at, updated_at)
SELECT
  'openclaw/crabfleet',
  enabled,
  created_at,
  unixepoch() * 1000
FROM repos
WHERE repo = 'theutopialabs/lobsterfleet';

UPDATE cards
SET repo = 'openclaw/crabfleet'
WHERE repo = 'theutopialabs/lobsterfleet';

INSERT OR IGNORE INTO repo_workflows (
  repo,
  status,
  source_path,
  source_sha,
  config_json,
  prompt,
  error,
  evaluated_at,
  updated_at
)
SELECT
  'openclaw/crabfleet',
  status,
  source_path,
  source_sha,
  config_json,
  prompt,
  error,
  evaluated_at,
  unixepoch() * 1000
FROM repo_workflows
WHERE repo = 'theutopialabs/lobsterfleet';

DELETE FROM repo_workflows
WHERE repo = 'theutopialabs/lobsterfleet';

DELETE FROM repo_workflows
WHERE repo = 'theutopialabs/crabbox'
  AND NOT EXISTS (
    SELECT 1
    FROM cards
    WHERE cards.repo = 'theutopialabs/crabbox'
  );

DELETE FROM repos
WHERE repo = 'theutopialabs/lobsterfleet';

DELETE FROM repos
WHERE repo = 'theutopialabs/crabbox'
  AND NOT EXISTS (
    SELECT 1
    FROM cards
    WHERE cards.repo = 'theutopialabs/crabbox'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM repo_workflows
    WHERE repo_workflows.repo = 'theutopialabs/crabbox'
  );

DELETE FROM allow_entries
WHERE value IN ('@vishnukeshavsenthil', '@theutopialabs/maintainer', '@theutopialabs/maintainers');
