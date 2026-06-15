// One terminal tile. Header (repo + branch + state + actions), an xterm body
// bridged over the ws hub, and a footer (id, elapsed, status). While the box
// is still provisioning we show an animated "leasing" state instead of a term.

import { motion } from "framer-motion";
import { useState } from "react";
import { GitBranch, Maximize2, Minimize2, Monitor, ScrollText, X } from "lucide-react";
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
import { IconButton } from "../../components/Button";
import { Chip, StatePill } from "../../components/Pill";
import { Terminal } from "./Terminal";

// these states mean the box is not ready to attach yet
const PROVISIONING = ["provisioning", "pending_adapter"];

export function SessionTile({
  session,
  index,
  maximized,
  onMaximize,
  onLogs,
  shareToken,
  showActions = true,
}: {
  session: InteractiveSession;
  index: number;
  maximized: boolean;
  onMaximize: () => void;
  onLogs: (session: InteractiveSession) => void;
  shareToken?: string;
  showActions?: boolean;
}) {
  const { refresh, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const active = sessionIsActive(session.status);
  const provisioning = PROVISIONING.includes(session.status);
  const vnc = runtimeHasVnc(session.runtime) && session.vncUrl;

  const closeSession = async () => {
    setBusy(true);
    try {
      await endpoints.sessionAction(session.id, "stop");
      toast(`Released ${session.id}`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not release", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 * index, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`glass flex flex-col overflow-hidden rounded-2xl ${maximized ? "h-[78vh]" : "h-[clamp(300px,38vh,460px)]"}`}
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--color-ink)]">{session.repo}</div>
          <div className="flex items-center gap-1 truncate text-[11px] text-[var(--color-faint)]">
            <GitBranch size={11} strokeWidth={2} className="shrink-0" />
            <span className="truncate">{session.branch}</span>
          </div>
        </div>
        <StatePill status={session.status} label={sessionStatusLabel(session.status)} />
        {showActions && (
          <div className="ml-1 flex items-center">
            <IconButton label={maximized ? "Restore" : "Maximize"} onClick={onMaximize}>
              {maximized ? <Minimize2 size={15} strokeWidth={2} /> : <Maximize2 size={15} strokeWidth={2} />}
            </IconButton>
            {vnc && (
              <IconButton
                label="Open VNC"
                onClick={() => window.open(session.vncUrl!, "_blank", "noopener,noreferrer")}
              >
                <Monitor size={15} strokeWidth={2} />
              </IconButton>
            )}
            <IconButton label="Logs" onClick={() => onLogs(session)}>
              <ScrollText size={15} strokeWidth={2} />
            </IconButton>
            {session.canManage && (
              <IconButton
                label="Close session"
                onClick={closeSession}
                className={busy ? "opacity-50" : "hover:text-[var(--color-danger)]"}
              >
                <X size={15} strokeWidth={2} />
              </IconButton>
            )}
          </div>
        )}
      </div>

      {/* body */}
      <div className="relative min-h-0 flex-1 bg-[var(--color-bg-soft)]">
        {provisioning ? (
          <Provisioning event={session.lastEvent} />
        ) : active ? (
          <div className="absolute inset-0 p-2">
            <Terminal
              sessionId={session.id}
              readOnly={session.sharedReadOnly}
              shareToken={shareToken}
            />
          </div>
        ) : (
          <div className="grid h-full place-items-center text-xs text-[var(--color-faint)]">
            {sessionStatusLabel(session.status)} · no live terminal
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex items-center gap-3 border-t border-[var(--color-line)] px-4 py-2 text-[11px] text-[var(--color-faint)]">
        <Chip mono>{session.id}</Chip>
        <span>up {elapsed(session.createdAt)}</span>
        <span className="ml-auto">{runtimeLabel(session.runtime)}</span>
      </div>
    </motion.div>
  );
}

// Animated "leasing a box" state for sessions still provisioning.
function Provisioning({ event }: { event: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative h-10 w-10">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-accent)]/30" />
          <span className="absolute inset-2 rounded-full bg-[var(--color-accent)]/60" />
        </div>
        <div className="text-sm text-[var(--color-muted)]">leasing a box...</div>
        {event && <div className="max-w-[80%] truncate text-[11px] text-[var(--color-faint)]">{event}</div>}
      </div>
    </div>
  );
}
