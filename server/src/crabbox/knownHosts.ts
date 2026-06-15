import type { DatabaseSync } from "node:sqlite";

// TOFU host key pinning for leased crabboxes. Keyed by lease id, not host/ip:
// the broker reuses ips across leases, so a fresh box on a recycled ip would
// look like a key change. Lease ids are unique per box, so first connect records
// the host key and later connects to the same lease verify it. Mismatch = abort.

export type KnownHosts = {
  // The pinned host key hash for a lease, or null if we have not seen it yet.
  get(leaseId: string): string | null;
  // Pin the host key hash on first use.
  set(leaseId: string, hostKeyHash: string): void;
  // Drop the pin (called when the lease is released).
  remove(leaseId: string): void;
};

// Backed by the raw node:sqlite handle so lookups are sync (the ssh hostVerifier
// callback wants a quick answer). Creates its table on first use.
export function createKnownHosts(raw: DatabaseSync): KnownHosts {
  raw.exec(
    `CREATE TABLE IF NOT EXISTS crabbox_known_hosts (
       lease_id TEXT PRIMARY KEY,
       host_key TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  );
  const getStmt = raw.prepare("SELECT host_key FROM crabbox_known_hosts WHERE lease_id = ?");
  const setStmt = raw.prepare(
    `INSERT INTO crabbox_known_hosts(lease_id, host_key, created_at) VALUES(?, ?, ?)
     ON CONFLICT(lease_id) DO UPDATE SET host_key = excluded.host_key`,
  );
  const delStmt = raw.prepare("DELETE FROM crabbox_known_hosts WHERE lease_id = ?");
  return {
    get(leaseId) {
      const row = getStmt.get(leaseId) as { host_key: string } | undefined;
      return row ? row.host_key : null;
    },
    set(leaseId, hostKeyHash) {
      setStmt.run(leaseId, hostKeyHash, Date.now());
    },
    remove(leaseId) {
      delStmt.run(leaseId);
    },
  };
}
