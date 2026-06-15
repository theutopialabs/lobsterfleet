// Run drawer. A wider slide-over opened from a Board card. Shows the run's
// log/terminal output, a diff view (files + +/- + compact patch), the runtime
// capabilities grid, and actions (watch, take over, mark stalled).

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ApiError, endpoints } from "../../lib/api";
import type { Card, RuntimeCapabilities } from "../../lib/api";
import {
  diffStatusChar,
  elapsed,
  mergePolicyLabel,
  runtimeLabel,
  sessionIsFinished,
  sessionStatusLabel,
} from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button, IconButton } from "../../components/Button";
import { Field, Select } from "../../components/Field";
import { Chip, StatePill } from "../../components/Pill";
import { Segmented } from "../../components/Segmented";
import { Terminal } from "../sessions/Terminal";

type Tab = "output" | "diff" | "leases" | "caps";

export function RunDrawer({ card, onClose }: { card: Card | null; onClose: () => void }) {
  const { refresh, toast } = useStore();
  const [tab, setTab] = useState<Tab>("output");
  const [busy, setBusy] = useState<string | null>(null);

  // close on escape
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  // reset to the output tab whenever a new card opens
  useEffect(() => {
    if (card) setTab("output");
  }, [card?.id]);

  const run = card?.run ?? null;
  const active = card?.lane === "Running";
  const caps = run?.capabilities;

  const runAction = async (action: string, note: string) => {
    if (!card) return;
    setBusy(action);
    try {
      await endpoints.cardAction(card.id, action);
      toast(note);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {card && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className="glass absolute right-0 top-0 flex h-full w-full max-w-[680px] flex-col border-l border-y-0 border-r-0"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            {/* header */}
            <header className="flex items-start gap-3 border-b border-[var(--color-line)] px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold tracking-tight">{card.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Chip mono>{card.id}</Chip>
                  <Chip>{card.repo}</Chip>
                  <Chip>{runtimeLabel(card.runtime)}</Chip>
                  <Chip>{mergePolicyLabel(card.policy)}</Chip>
                  {run && <Chip mono>{run.id}</Chip>}
                </div>
              </div>
              {run && <StatePill status={run.status} />}
              <IconButton label="Close" onClick={onClose}>
                ✕
              </IconButton>
            </header>

            {/* tabs */}
            <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-6 py-3">
              <Segmented<Tab>
                idBase="run-tabs"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "output", label: "Output" },
                  { value: "diff", label: `Diff (${card.changes?.totals.files ?? 0})` },
                  { value: "leases", label: `Leases (${card.leaseLinks?.length ?? 0})` },
                  { value: "caps", label: "Capabilities" },
                ]}
              />
              {active && run && (
                <span className="ml-auto text-xs text-[var(--color-faint)]">
                  running {elapsed(card.startedAt)}
                </span>
              )}
            </div>

            {/* body */}
            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
              {tab === "output" && <OutputPane card={card} />}
              {tab === "diff" && <DiffPane card={card} />}
              {tab === "leases" && <LeasesPane card={card} />}
              {tab === "caps" && <CapsPane caps={caps} reason={run?.selectionReason} />}
            </div>

            {/* actions */}
            <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] px-6 py-4">
              <Button
                variant="ghost"
                busy={busy === "watch"}
                onClick={() => runAction("watch", `Watching ${card.id}`)}
              >
                Watch
              </Button>
              {caps?.takeover && (
                <Button
                  variant="primary"
                  busy={busy === "takeover"}
                  onClick={() => runAction("takeover", `Took over ${card.id}`)}
                >
                  Take over
                </Button>
              )}
              {active && (
                <Button
                  variant="danger"
                  busy={busy === "stall"}
                  onClick={() => runAction("stall", `Marked ${card.id} stalled`)}
                >
                  Mark stalled
                </Button>
              )}
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

// Run output. Live runs get a read-only xterm bridged to their session,
// otherwise we show the captured log lines.
function OutputPane({ card }: { card: Card }) {
  const live = card.lane === "Running" && card.run?.status === "running";
  // the run attempt id doubles as the terminal session id for live runs
  const sessionId = card.run?.id ?? null;

  if (live && sessionId) {
    return (
      <RunTerminal sessionId={sessionId} />
    );
  }
  const lines = card.logs ?? [];
  return (
    <pre className="h-full min-h-[260px] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-soft)] p-4 font-mono text-xs leading-relaxed text-[var(--color-muted)]">
      {lines.length ? lines.join("\n") : "No output captured yet."}
    </pre>
  );
}

// Lazy-ish wrapper so we only import the heavy Terminal when a live run is open.
function RunTerminal({ sessionId }: { sessionId: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="h-[360px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-soft)] p-2">
      {failed ? (
        <div className="grid h-full place-items-center text-xs text-[var(--color-faint)]">{failed}</div>
      ) : (
        <LiveRunTerminal sessionId={sessionId} onError={setFailed} />
      )}
    </div>
  );
}

function LiveRunTerminal({ sessionId, onError }: { sessionId: string; onError: (m: string) => void }) {
  return (
    <Terminal
      sessionId={sessionId}
      readOnly
      onStatus={(s, note) => {
        if (s === "error") onError(note || "run terminal unavailable");
      }}
    />
  );
}

function LeasesPane({ card }: { card: Card }) {
  const { state, refresh, toast } = useStore();
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const links = card.leaseLinks ?? [];
  const linkedSessionIds = useMemo(
    () => new Set(links.map((link) => link.sessionId).filter(Boolean)),
    [links],
  );
  const activeSessions = useMemo(
    () =>
      (state?.interactiveSessions ?? []).filter((session) => !sessionIsFinished(session.status)),
    [state?.interactiveSessions],
  );
  const sessions = useMemo(
    () =>
      activeSessions.filter((session) => !linkedSessionIds.has(session.id)),
    [activeSessions, linkedSessionIds],
  );
  const attachHint =
    sessions.length > 0
      ? undefined
      : activeSessions.length > 0
        ? "all active sessions linked"
        : "no active sessions";
  const emptyLabel = activeSessions.length > 0 ? "All active sessions are linked" : "No active sessions";

  useEffect(() => {
    setSessionId((current) =>
      current && sessions.some((session) => session.id === current)
        ? current
        : (sessions[0]?.id ?? ""),
    );
  }, [sessions]);

  const attach = async () => {
    if (!sessionId) return;
    setBusy("attach");
    try {
      await endpoints.attachCardLease(card.id, {
        sessionId,
        role: "primary",
        source: "manual_attach",
      });
      toast(`Attached ${sessionId} to ${card.id}`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not attach lease", "error");
    } finally {
      setBusy(null);
    }
  };

  const detach = async (linkId: string) => {
    setBusy(linkId);
    try {
      await endpoints.detachCardLease(card.id, linkId);
      toast(`Detached lease from ${card.id}`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not detach lease", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {links.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-[var(--color-line)] py-12 text-sm text-[var(--color-faint)]">
          No leases linked yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {links.map((link) => (
            <div
              key={link.id}
              className="rounded-xl border border-[var(--color-line)] bg-white/[0.02] p-3"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--color-ink)]">
                    {link.session?.repo ?? link.leaseId ?? link.id}
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--color-muted)]">
                    {link.session?.summary || link.sessionId || link.runId || link.leaseId}
                  </div>
                </div>
                {link.session && (
                  <StatePill status={link.session.status} label={sessionStatusLabel(link.session.status)} />
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Chip mono>{link.id}</Chip>
                {link.sessionId && <Chip mono>{link.sessionId}</Chip>}
                {link.leaseId && <Chip mono>{link.leaseId}</Chip>}
                <Chip>{link.source.replace("_", " ")}</Chip>
                <Chip>{link.role}</Chip>
              </div>
              {link.session?.attentionState === "needs_input" && (
                <div
                  role="status"
                  className="mt-3 rounded-lg border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-3 py-2 text-xs leading-snug text-[var(--color-warning)]"
                >
                  <span className="font-medium">Needs input</span>
                  <span className="text-[var(--color-muted)]">
                    {" "}
                    - {link.session.attentionReason || "Agent is waiting for input"}
                  </span>
                </div>
              )}
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="danger"
                  busy={busy === link.id}
                  onClick={() => detach(link.id)}
                >
                  Detach
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-line)] bg-white/[0.02] p-3">
        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
          Attach existing crabbox
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Session" hint={attachHint}>
              <Select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                disabled={sessions.length === 0}
              >
                <option value="">{sessions.length ? "Pick a session" : emptyLabel}</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.id} · {session.repo} · {sessionStatusLabel(session.status)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button variant="primary" busy={busy === "attach"} disabled={!sessionId} onClick={attach}>
            Attach
          </Button>
        </div>
      </div>
    </div>
  );
}

// Diff view. File list with +/- counts and a compact colorized patch render.
function DiffPane({ card }: { card: Card }) {
  const changes = card.changes;
  const files = changes?.files ?? [];
  const totals = changes?.totals;

  if (!totals || totals.files === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-[var(--color-line)] py-16 text-sm text-[var(--color-faint)]">
        No changes yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-xs tabular-nums">
        <span className="text-[var(--color-muted)]">
          {totals.files} {totals.files === 1 ? "file" : "files"}
        </span>
        <span className="text-[var(--color-success)]">+{totals.additions}</span>
        <span className="text-[var(--color-danger)]">-{totals.deletions}</span>
      </div>

      <div className="flex flex-col divide-y divide-[var(--color-line-soft)] rounded-xl border border-[var(--color-line)]">
        {files.map((f) => (
          <div key={f.path} className="flex items-center gap-3 px-3 py-2">
            <span
              className="grid h-5 w-5 place-items-center rounded text-[10px] font-semibold"
              style={statusStyle(f.status)}
            >
              {diffStatusChar(f.status)}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-ink)]">
              {f.oldPath && f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path}
            </span>
            <span className="text-[11px] tabular-nums text-[var(--color-success)]">+{f.additions}</span>
            <span className="text-[11px] tabular-nums text-[var(--color-danger)]">-{f.deletions}</span>
          </div>
        ))}
      </div>

      {changes.patch && <Patch patch={changes.patch} />}
    </div>
  );
}

// Compact patch render. Adds/removes/hunks get their own color.
function Patch({ patch }: { patch: string }) {
  const lines = patch.split("\n").slice(0, 600);
  return (
    <pre className="overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-soft)] p-3 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} style={{ color: patchColor(line) }}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function patchColor(line: string): string {
  if (line.startsWith("@@")) return "var(--color-accent-2)";
  if (line.startsWith("+++") || line.startsWith("---")) return "var(--color-faint)";
  if (line.startsWith("+")) return "var(--color-success)";
  if (line.startsWith("-")) return "var(--color-danger)";
  return "var(--color-muted)";
}

function statusStyle(status: string): { background: string; color: string } {
  const map: Record<string, string> = {
    added: "var(--color-success)",
    deleted: "var(--color-danger)",
    renamed: "var(--color-accent-2)",
    modified: "var(--color-warning)",
  };
  const c = map[status] ?? "var(--color-muted)";
  return { background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c };
}

// Runtime capabilities grid (yes/no for terminal/takeover/vnc/desktop/logs/artifacts).
const CAP_LABELS: { key: keyof RuntimeCapabilities; label: string }[] = [
  { key: "terminal", label: "Terminal" },
  { key: "takeover", label: "Take over" },
  { key: "vnc", label: "VNC" },
  { key: "desktop", label: "Desktop" },
  { key: "logs", label: "Logs" },
  { key: "artifacts", label: "Artifacts" },
];

function CapsPane({ caps, reason }: { caps?: RuntimeCapabilities; reason?: string | null }) {
  if (!caps) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-[var(--color-line)] py-16 text-sm text-[var(--color-faint)]">
        No run yet, so no runtime capabilities.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CAP_LABELS.map(({ key, label }) => {
          const on = caps[key];
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-3 py-2.5"
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                  on
                    ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                    : "bg-white/[0.05] text-[var(--color-faint)]"
                }`}
              >
                {on ? "✓" : "·"}
              </span>
              <span className="text-sm text-[var(--color-ink)]">{label}</span>
            </div>
          );
        })}
      </div>
      {reason && (
        <div className="rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-3 py-2.5 text-xs text-[var(--color-muted)]">
          <span className="text-[var(--color-faint)]">runtime pick: </span>
          {reason}
        </div>
      )}
    </div>
  );
}
