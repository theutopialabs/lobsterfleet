// Fleet view. Status strip + boxes grouped by operator + new crabbox sheet.

import { useEffect, useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import { ApiError, endpoints } from "../../lib/api";
import type { Card, InteractiveSession } from "../../lib/api";
import { sessionIsActive, sessionIsFinished } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Field, Select } from "../../components/Field";
import { Chip } from "../../components/Pill";
import { Sheet } from "../../components/Sheet";
import { Stat } from "../../components/Stat";
import { BoxTile } from "./BoxTile";
import { NewBoxSheet } from "./NewBoxSheet";

export function FleetView({ onOpenSessions }: { onOpenSessions: () => void }) {
  const { state, refresh, toast } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<InteractiveSession | null>(null);
  const [boardForId, setBoardForId] = useState<string | null>(null);

  const sessions = state?.interactiveSessions ?? [];
  const repos = state?.repos ?? [];
  const cards = state?.cards ?? [];
  const boardFor = boardForId ? (sessions.find((session) => session.id === boardForId) ?? null) : null;

  // Released boxes are gone. Keep their dead tiles out of the active grid. They
  // can still be purged for good with "Clear finished".
  const live = useMemo(() => sessions.filter((s) => !sessionIsFinished(s.status)), [sessions]);
  const finishedCount = sessions.length - live.length;

  // group boxes by owner so the fleet reads operator-by-operator
  const groups = useMemo(() => {
    const byOwner = new Map<string, InteractiveSession[]>();
    for (const s of live) {
      const list = byOwner.get(s.owner) ?? [];
      list.push(s);
      byOwner.set(s.owner, list);
    }
    return [...byOwner.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [live]);

  const running = live.filter((s) => sessionIsActive(s.status)).length;
  const operators = new Set(live.map((s) => s.owner)).size;

  const clearFinished = async () => {
    try {
      const { removedIds } = await endpoints.cleanupSessions();
      await refresh();
      toast(`Cleared ${removedIds.length} finished box${removedIds.length === 1 ? "" : "es"}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not clear finished", "error");
    }
  };

  const onAttach = async (session: InteractiveSession) => {
    try {
      await endpoints.sessionAction(session.id, "attach");
      await refresh();
      onOpenSessions();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not attach", "error");
    }
  };

  return (
    <div className="w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Fleet</h1>
          <p className="mt-1 text-[var(--color-muted)]">
            Every crabbox, by operator and state. Lease, attach, babysit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {finishedCount > 0 && (
            <Button variant="subtle" onClick={clearFinished}>
              Clear finished ({finishedCount})
            </Button>
          )}
          <Button variant="primary" onClick={() => setSheetOpen(true)}>
            + New crabbox
          </Button>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Running" value={running} accent="var(--color-success)" index={0} />
        <Stat label="Boxes" value={sessions.length} accent="var(--color-accent-2)" index={1} />
        <Stat label="Operators" value={operators} accent="var(--color-accent)" index={2} />
      </div>

      {sessions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Boxes size={26} strokeWidth={1.8} />}
            title="No boxes leased yet"
            body="Lease a crabbox through the broker and a live workspace shows up here, grouped by operator."
            action={
              <Button variant="primary" onClick={() => setSheetOpen(true)}>
                + New crabbox
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {groups.map(([owner, boxes]) => (
            <section key={owner}>
              <div className="mb-3 flex items-center gap-3">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-accent)]/20 text-xs font-medium text-[var(--color-accent-2)]">
                  {owner[0]?.toUpperCase() ?? "?"}
                </div>
                <h2 className="text-sm font-medium text-[var(--color-ink)]">{owner}</h2>
                <span className="text-xs text-[var(--color-faint)]">
                  {boxes.length} {boxes.length === 1 ? "box" : "boxes"}
                </span>
                <div className="h-px flex-1 bg-[var(--color-line)]" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {boxes.map((s, i) => (
                  <BoxTile
                    key={s.id}
                    session={s}
                    index={i}
                    onAttach={onAttach}
                    onBoard={(session) => setBoardForId(session.id)}
                    onLogs={setLogsFor}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <NewBoxSheet open={sheetOpen} onClose={() => setSheetOpen(false)} repos={repos} />

      <BoardLinkSheet session={boardFor} cards={cards} onClose={() => setBoardForId(null)} />

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

function BoardLinkSheet({
  session,
  cards,
  onClose,
}: {
  session: InteractiveSession | null;
  cards: Card[];
  onClose: () => void;
}) {
  const { refresh, toast } = useStore();
  const [cardId, setCardId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const linkedIds = useMemo(
    () => new Set((session?.boardLinks ?? []).map((link) => link.cardId)),
    [session],
  );
  const availableCards = useMemo(
    () => cards.filter((card) => !linkedIds.has(card.id)),
    [cards, linkedIds],
  );
  const attachHint =
    availableCards.length > 0
      ? undefined
      : cards.length > 0
        ? "all cards linked"
        : "no cards";
  const emptyLabel = cards.length > 0 ? "All cards are linked" : "No cards";

  useEffect(() => {
    if (!session) {
      setCardId("");
      return;
    }
    setCardId((current) =>
      current && availableCards.some((card) => card.id === current)
        ? current
        : (availableCards[0]?.id ?? ""),
    );
  }, [session, availableCards]);

  const attach = async () => {
    if (!session || !cardId) return;
    setBusy("attach");
    try {
      await endpoints.attachCardLease(cardId, {
        sessionId: session.id,
        role: "primary",
        source: "manual_attach",
      });
      toast(`Attached ${session.id} to ${cardId}`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not attach to board", "error");
    } finally {
      setBusy(null);
    }
  };

  const detach = async (linkId: string, targetCardId: string) => {
    setBusy(linkId);
    try {
      await endpoints.detachCardLease(targetCardId, linkId);
      toast(`Detached ${session?.id ?? "session"} from ${targetCardId}`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not detach from board", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open={Boolean(session)}
      onClose={onClose}
      title="Board link"
      subtitle={session?.id}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" busy={busy === "attach"} disabled={!cardId} onClick={attach}>
            Attach
          </Button>
        </>
      }
    >
      {session && (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-[var(--color-line)] bg-white/[0.02] p-3">
            <div className="text-sm font-medium text-[var(--color-ink)]">{session.repo}</div>
            <div className="mt-1 text-xs text-[var(--color-muted)]">
              {session.summary || session.purpose || session.id}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip mono>{session.id}</Chip>
              <Chip>{session.status}</Chip>
              {session.leaseId && <Chip mono>{session.leaseId}</Chip>}
            </div>
          </div>

          {(session.boardLinks ?? []).length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
                Linked cards
              </div>
              {session.boardLinks.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[var(--color-ink)]">
                      {link.cardTitle ?? link.cardId}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--color-faint)]">
                      {link.cardId}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    busy={busy === link.id}
                    onClick={() => detach(link.id, link.cardId)}
                  >
                    Detach
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Field label="Attach to card" hint={attachHint}>
            <Select
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              disabled={availableCards.length === 0}
            >
              <option value="">{availableCards.length ? "Pick a card" : emptyLabel}</option>
              {availableCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.id} · {card.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Sheet>
  );
}
