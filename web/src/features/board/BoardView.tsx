// Board view. Kanban lanes Todo / Running / Human Review / Done, fed from
// state.cards, with search + filter + new card.

import { useMemo, useState } from "react";
import type { Card, GitHubReference, Lane } from "../../lib/api";
import { LANES, firstLine } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button } from "../../components/Button";
import { CardTile } from "./CardTile";
import { BoardToolbar } from "./BoardToolbar";
import type { BoardFilter } from "./BoardToolbar";
import { NewCardSheet } from "./NewCardSheet";
import { RunDrawer } from "../run/RunDrawer";

// dot color next to each lane header
const LANE_DOT: Record<Lane, string> = {
  Todo: "var(--color-faint)",
  Running: "var(--color-success)",
  "Human Review": "var(--color-warning)",
  Done: "var(--color-accent-2)",
};

export function BoardView() {
  const { state } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [seed, setSeed] = useState<GitHubReference | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const cards = state?.cards ?? [];
  // resolve the open card fresh from state so the drawer stays live as we poll
  const openCard = openId ? (cards.find((c) => c.id === openId) ?? null) : null;
  const repos = state?.repos ?? [];
  const me = state?.user;
  const canMaintain = me?.role === "maintainer" || me?.role === "owner";

  // apply text search + the mine/live filter. a bare #123 query is a github
  // lookup (handled in the toolbar), so do not let it hide all cards.
  const filtered = useMemo(() => {
    const isRefQuery = /^#?\d+$/.test(query.trim());
    const q = isRefQuery ? "" : query.trim().toLowerCase();
    return cards.filter((card) => {
      if (filter === "mine" && me && card.owner !== me.login && card.owner !== me.subject)
        return false;
      if (filter === "live" && card.lane !== "Running") return false;
      if (q) {
        const hay = `${card.title} ${firstLine(card.prompt)} ${card.repo} ${card.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, query, filter, me]);

  const byLane = useMemo(() => {
    const map = new Map<Lane, Card[]>(LANES.map((l) => [l, []]));
    for (const card of filtered) {
      const lane = (LANES.includes(card.lane as Lane) ? card.lane : "Todo") as Lane;
      map.get(lane)!.push(card);
    }
    return map;
  }, [filtered]);

  const openWithRef = (ref: GitHubReference) => {
    setSeed(ref);
    setSheetOpen(true);
  };

  const openBlank = () => {
    setSeed(null);
    setSheetOpen(true);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Board</h1>
          <p className="mt-1 text-[var(--color-muted)]">
            Tasks across the fleet, lane by lane. Queue, pulse, review, ship.
          </p>
        </div>
        <Button variant="primary" onClick={openBlank}>
          + New card
        </Button>
      </div>

      <div className="mt-6">
        <BoardToolbar
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          onPickRef={openWithRef}
        />
      </div>

      <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => {
          const laneCards = byLane.get(lane) ?? [];
          return (
            <div key={lane} className="flex min-w-0 flex-col">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: LANE_DOT[lane] }}
                />
                <h2 className="text-sm font-medium text-[var(--color-ink)]">{lane}</h2>
                <span className="text-xs tabular-nums text-[var(--color-faint)]">
                  {laneCards.length}
                </span>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-line-soft)] bg-white/[0.012] p-3">
                {laneCards.length === 0 ? (
                  <div className="grid place-items-center rounded-xl border border-dashed border-[var(--color-line)] py-10 text-xs text-[var(--color-faint)]">
                    nothing here
                  </div>
                ) : (
                  laneCards.map((card, i) => (
                    <CardTile
                      key={card.id}
                      card={card}
                      index={i}
                      canMaintain={canMaintain}
                      onOpen={(c) => setOpenId(c.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <NewCardSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        repos={repos}
        seed={seed}
      />

      <RunDrawer card={openCard} onClose={() => setOpenId(null)} />
    </div>
  );
}
