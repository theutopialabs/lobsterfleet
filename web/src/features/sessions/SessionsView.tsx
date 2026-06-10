// Sessions view. A responsive grid of live terminal tiles, one per active
// interactive session, each bridged to the ws hub via xterm. Maximize collapses
// the grid to a single tall tile. New session reuses the New crabbox sheet.

import { useMemo, useState } from "react";
import type { InteractiveSession } from "../../lib/api";
import { sessionIsActive } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Sheet } from "../../components/Sheet";
import { Stat } from "../../components/Stat";
import { NewBoxSheet } from "../fleet/NewBoxSheet";
import { SessionTile } from "./SessionTile";

export function SessionsView() {
  const { state } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [maxId, setMaxId] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<InteractiveSession | null>(null);

  const sessions = state?.interactiveSessions ?? [];
  const repos = state?.repos ?? [];

  // show live sessions first, terminal ones after
  const live = useMemo(
    () =>
      [...sessions]
        .filter((s) => sessionIsActive(s.status))
        .sort((a, b) => b.createdAt - a.createdAt),
    [sessions],
  );

  // surface fresh failures here too. without this a failed lease only shows
  // on Fleet and the user who just clicked "Lease" sees nothing happen.
  const recentFailed = useMemo(
    () =>
      sessions.filter(
        (s) => s.status === "failed" && Date.now() - s.createdAt < 60 * 60 * 1000,
      ),
    [sessions],
  );

  const provisioning = live.filter((s) =>
    ["provisioning", "pending_adapter"].includes(s.status),
  ).length;

  // when one tile is maximized, only render that tile
  const shown = maxId ? live.filter((s) => s.id === maxId) : live;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Sessions</h1>
          <p className="mt-1 text-[var(--color-muted)]">
            Live terminals, one per crabbox, bridged over SSH. Type right in.
          </p>
        </div>
        <Button variant="primary" onClick={() => setSheetOpen(true)}>
          + New session
        </Button>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Live" value={live.length} accent="var(--color-success)" index={0} />
        <Stat label="Provisioning" value={provisioning} accent="var(--color-warning)" index={1} />
        <Stat label="Total" value={sessions.length} accent="var(--color-accent-2)" index={2} />
      </div>

      {recentFailed.length > 0 && (
        <div className="mt-6 rounded-xl border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/[0.06] px-4 py-3">
          {recentFailed.slice(0, 3).map((s) => (
            <div key={s.id} className="flex items-baseline gap-3 py-0.5 text-xs">
              <span className="shrink-0 font-mono text-[var(--color-danger)]">{s.id}</span>
              <span className="min-w-0 truncate text-[var(--color-muted)]">
                {s.lastEvent || "lease failed"}
              </span>
            </div>
          ))}
        </div>
      )}

      {live.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            glyph="▦"
            title="No live sessions"
            body="Lease a crabbox and a live terminal lands here, ready to type into."
            action={
              <Button variant="primary" onClick={() => setSheetOpen(true)}>
                + New session
              </Button>
            }
          />
        </div>
      ) : (
        <div
          className={`mt-8 grid gap-5 ${
            maxId ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3"
          }`}
        >
          {shown.map((s, i) => (
            <SessionTile
              key={s.id}
              session={s}
              index={i}
              maximized={maxId === s.id}
              onMaximize={() => setMaxId(maxId === s.id ? null : s.id)}
              onLogs={setLogsFor}
            />
          ))}
        </div>
      )}

      <NewBoxSheet open={sheetOpen} onClose={() => setSheetOpen(false)} repos={repos} />

      <Sheet
        open={Boolean(logsFor)}
        onClose={() => setLogsFor(null)}
        title="Session logs"
        subtitle={logsFor?.id}
      >
        {logsFor && (
          <pre className="max-h-full overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-soft)] p-4 font-mono text-xs leading-relaxed text-[var(--color-muted)]">
            {logsFor.logs.length ? logsFor.logs.join("\n") : "No log lines yet."}
          </pre>
        )}
      </Sheet>
    </div>
  );
}
