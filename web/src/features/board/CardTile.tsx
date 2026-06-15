// One kanban card. Title + prompt excerpt + chips + diff summary + run chip,
// with a left accent border colored by lane and Start/Advance actions.

import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, endpoints } from "../../lib/api";
import type { Card, Lane } from "../../lib/api";
import { elapsed, firstLine, mergePolicyLabel, runtimeLabel } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button, IconButton } from "../../components/Button";
import { Chip, StatePill } from "../../components/Pill";

// left accent stripe per lane
const LANE_ACCENT: Record<Lane, string> = {
  Todo: "var(--color-faint)",
  Running: "var(--color-success)",
  "Human Review": "var(--color-warning)",
  Done: "var(--color-accent-2)",
};

export function CardTile({
  card,
  index,
  canMaintain,
  onOpen,
}: {
  card: Card;
  index: number;
  canMaintain: boolean;
  // open the run drawer for this card
  onOpen: (card: Card) => void;
}) {
  const { refresh, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const accent = LANE_ACCENT[card.lane as Lane] ?? "var(--color-faint)";
  const excerpt = firstLine(card.prompt);
  const totals = card.changes?.totals;
  const hasDiff = totals && totals.files > 0;
  const running = card.lane === "Running";
  const leaseLinks = card.leaseLinks ?? [];
  const attentionLink = leaseLinks.find((link) => link.session?.attentionState === "needs_input");
  const attentionReason =
    attentionLink?.session?.attentionReason || "Agent is waiting for input";

  const runAction = async (action: string, note: string) => {
    setBusy(action);
    try {
      await endpoints.cardAction(card.id, action);
      toast(note);
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Action failed";
      toast(msg, "error");
    } finally {
      setBusy(null);
    }
  };

  const deleteCard = async () => {
    const confirmed = window.confirm(`Delete ${card.id}? This removes its events and run history.`);
    if (!confirmed) return;
    setBusy("delete");
    try {
      await endpoints.deleteCard(card.id);
      toast(`Deleted ${card.id}`);
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not delete card";
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
      transition={{ delay: 0.02 * index, duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="glass relative overflow-hidden rounded-xl p-4 pl-5"
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />

      <div className="flex items-start gap-2">
        <button
          onClick={() => onOpen(card)}
          aria-label={`Open details for ${card.title}`}
          className="min-w-0 flex-1 rounded text-left text-sm font-medium leading-snug text-[var(--color-ink)] transition hover:text-[var(--color-accent-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60"
        >
          {card.title}
        </button>
        {running && card.run && (
          <StatePill status={card.run.status} label={`${elapsed(card.startedAt)}`} />
        )}
        {canMaintain && (
          <IconButton
            label={`Delete card ${card.id}`}
            onClick={deleteCard}
            disabled={busy !== null}
            className={`-mr-1 -mt-1 shrink-0 ${busy ? "opacity-50" : "hover:text-[var(--color-danger)]"}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        )}
      </div>

      {excerpt && excerpt !== card.title && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--color-muted)]">
          {excerpt}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip mono>{card.id}</Chip>
        <Chip>{card.repo.split("/").pop()}</Chip>
        <Chip>{runtimeLabel(card.runtime)}</Chip>
        <Chip>{mergePolicyLabel(card.policy)}</Chip>
        {card.run && <Chip mono>{card.run.id}</Chip>}
        {leaseLinks.length > 0 && (
          <Chip mono>
            {leaseLinks.length === 1
              ? (leaseLinks[0].sessionId ?? leaseLinks[0].leaseId ?? "lease")
              : `${leaseLinks.length} leases`}
          </Chip>
        )}
      </div>

      {attentionLink && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-3 py-2 text-xs leading-snug text-[var(--color-warning)]"
        >
          <span className="font-medium">Needs input</span>
          <span className="text-[var(--color-muted)]">
            {" "}
            - {attentionLink.sessionId ?? "session"} - {attentionReason}
          </span>
        </div>
      )}

      {hasDiff && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-white/[0.02] px-3 py-2 text-[11px] tabular-nums">
          <span className="text-[var(--color-muted)]">
            {totals.files} {totals.files === 1 ? "file" : "files"}
          </span>
          <span className="text-[var(--color-success)]">+{totals.additions}</span>
          <span className="text-[var(--color-danger)]">-{totals.deletions}</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="subtle" onClick={() => onOpen(card)}>
          Details
        </Button>
        {canMaintain && (
          <>
            {!running && card.lane !== "Done" && (
              <Button
                size="sm"
                variant="primary"
                busy={busy === "start"}
                onClick={() => runAction("start", `Pulsed ${card.id}`)}
              >
                {card.lane === "Todo" ? "Start" : "Pulse"}
              </Button>
            )}
            {card.lane !== "Done" && (
              <Button
                size="sm"
                variant="ghost"
                busy={busy === "advance"}
                onClick={() => runAction("advance", `Advanced ${card.id}`)}
              >
                Advance →
              </Button>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
