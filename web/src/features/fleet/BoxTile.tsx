// One crabbox tile. Shows repo + state + meta + an ssh hint and the
// Attach / VNC / Logs / Release actions wired to the session actions API.

import { motion } from "framer-motion";
import { useState } from "react";
import { Check, Copy, GitBranch } from "lucide-react";
import { ApiError, endpoints } from "../../lib/api";
import type { InteractiveSession } from "../../lib/api";
import {
  elapsed,
  runtimeHasVnc,
  runtimeLabel,
  sessionIsActive,
  sessionStatusLabel,
} from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button } from "../../components/Button";
import { Chip, Pill, StatePill } from "../../components/Pill";

export function BoxTile({
  session,
  index,
  onAttach,
  onBoard,
  onLogs,
}: {
  session: InteractiveSession;
  index: number;
  onAttach: (session: InteractiveSession) => void;
  onBoard: (session: InteractiveSession) => void;
  onLogs: (session: InteractiveSession) => void;
}) {
  const { refresh, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const active = sessionIsActive(session.status);
  const vnc = runtimeHasVnc(session.runtime) && active && session.vncUrl;
  const needsInput = session.attentionState === "needs_input";

  // show the real box address once the lease lands, not a made-up command
  const sshTarget = (() => {
    if (session.attachUrl?.startsWith("ssh://")) {
      try {
        const u = new URL(session.attachUrl);
        return `${u.username ? `${u.username}@` : ""}${u.hostname}${u.port ? `:${u.port}` : ""}`;
      } catch {
        // fall through to the generic hint
      }
    }
    return null;
  })();
  const sshHint =
    sshTarget ??
    (session.leaseId ? "box leased · attach for a terminal" : "ssh target appears once provisioned");

  const copySsh = async () => {
    if (!sshTarget) return;
    try {
      await navigator.clipboard.writeText(`ssh ${sshTarget}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Could not copy to clipboard", "error");
    }
  };

  const runAction = async (action: string, note: string) => {
    setBusy(action);
    try {
      await endpoints.sessionAction(session.id, action);
      toast(note);
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Action failed";
      toast(msg, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ delay: 0.03 * index, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`glass relative flex flex-col gap-3 overflow-hidden rounded-2xl p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-float)] ${
        needsInput ? "ring-1 ring-[var(--color-warning)]/40" : ""
      }`}
    >
      {/* left accent rail: coral when it wants attention, aqua when alive */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[3px] ${
          needsInput
            ? "bg-[var(--color-warning)]"
            : active
              ? "bg-[var(--color-accent-2)]/70"
              : "bg-transparent"
        }`}
      />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--color-ink)]">{session.repo}</div>
          <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
            {session.summary || session.purpose || session.id}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {needsInput && <Pill tone="warning">Needs input</Pill>}
          <StatePill status={session.status} label={sessionStatusLabel(session.status)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip mono>{session.id}</Chip>
        <Chip>
          <GitBranch size={11} strokeWidth={2} />
          {session.branch}
        </Chip>
        <Chip>{runtimeLabel(session.runtime)}</Chip>
        {session.multiplayerMode && <Chip>multiplayer</Chip>}
        {(session.boardLinks ?? []).map((link) => (
          <Chip key={link.id} mono>
            {link.cardId}
          </Chip>
        ))}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-[var(--color-faint)]">
        <span>up {elapsed(session.createdAt)}</span>
        <span className="text-[var(--color-line)]">·</span>
        <span>idle {elapsed(session.lastSeenAt)}</span>
        {session.logArchive && (
          <>
            <span className="text-[var(--color-line)]">·</span>
            <span>{session.logArchive.eventCount} events</span>
          </>
        )}
      </div>

      {sshTarget ? (
        <button
          type="button"
          onClick={copySsh}
          title="Copy ssh command"
          className="group flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white/[0.02] px-2.5 py-1.5 text-left font-mono text-[11px] text-[var(--color-muted)] transition hover:border-[var(--color-accent-2)]/40 hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60"
        >
          <span className="shrink-0 text-[var(--color-accent-2)]">$</span>
          <span className="truncate">ssh {sshTarget}</span>
          {copied ? (
            <Check size={13} className="ml-auto shrink-0 text-[var(--color-success)]" />
          ) : (
            <Copy
              size={13}
              className="ml-auto shrink-0 text-[var(--color-faint)] transition group-hover:text-[var(--color-accent-2)]"
            />
          )}
        </button>
      ) : (
        <div className="truncate font-mono text-[11px] text-[var(--color-faint)]">{sshHint}</div>
      )}

      {session.lastEvent && (
        <div className="truncate text-xs text-[var(--color-muted)]">{session.lastEvent}</div>
      )}

      {needsInput && (
        <div
          role="status"
          className="rounded-lg border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-3 py-2 text-xs leading-snug text-[var(--color-warning)]"
        >
          {session.attentionReason || "Agent is waiting for input"}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => onAttach(session)} disabled={!active}>
          Attach
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onBoard(session)}>
          Board
        </Button>
        {vnc && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(session.vncUrl!, "_blank", "noopener,noreferrer")}
          >
            VNC
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onLogs(session)}>
          Logs
        </Button>
        {active && session.canManage && (
          <Button
            size="sm"
            variant="danger"
            busy={busy === "stop"}
            onClick={() => runAction("stop", `Released ${session.id}`)}
          >
            Release
          </Button>
        )}
      </div>
    </motion.div>
  );
}
