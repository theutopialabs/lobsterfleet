// Board toolbar. Search box (typing #123 looks up GitHub issues/PRs and
// shows matches in a popover to create a card from) plus the filter control.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ApiError, endpoints } from "../../lib/api";
import type { GitHubReference } from "../../lib/api";
import { useStore } from "../../lib/store";
import { Pill } from "../../components/Pill";
import { Spinner } from "../../components/Button";
import { Input } from "../../components/Field";
import { Segmented } from "../../components/Segmented";

export type BoardFilter = "all" | "mine" | "live";

export function BoardToolbar({
  query,
  onQuery,
  filter,
  onFilter,
  onPickRef,
}: {
  query: string;
  onQuery: (v: string) => void;
  filter: BoardFilter;
  onFilter: (v: BoardFilter) => void;
  onPickRef: (ref: GitHubReference) => void;
}) {
  const { toast } = useStore();
  const [matches, setMatches] = useState<GitHubReference[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // pull a #123 number out of the query if present
  const refNumber = (() => {
    const m = query.trim().match(/^#?(\d+)$/);
    return m ? Number(m[1]) : null;
  })();

  // when the query is a bare number, look up github refs (debounced)
  useEffect(() => {
    if (!refNumber) {
      setMatches([]);
      setOpen(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { matches } = await endpoints.githubRefs(refNumber);
        if (!alive) return;
        setMatches(matches);
        setOpen(true);
      } catch (err) {
        if (!alive) return;
        // 403 = not a maintainer, anything else = lookup trouble
        const msg = err instanceof ApiError ? err.message : "GitHub lookup failed";
        toast(msg, "warn");
        setMatches([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refNumber, toast]);

  // close popover on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div ref={boxRef} className="relative min-w-[260px] flex-1">
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onFocus={() => matches.length && setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          role="combobox"
          aria-expanded={open}
          aria-label="Search cards or look up a GitHub issue or PR by number"
          placeholder="Search cards, or type #123 to pull a GitHub issue / PR"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]">
            <Spinner />
          </span>
        )}

        <AnimatePresence>
          {open && refNumber && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-xl"
              role="listbox"
            >
              {matches.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[var(--color-muted)]">
                  {searching ? "Looking up..." : `No issue or PR #${refNumber} in your repos`}
                </div>
              ) : (
                matches.map((ref) => (
                  <button
                    key={`${ref.repo}#${ref.number}`}
                    onClick={() => {
                      onPickRef(ref);
                      setOpen(false);
                    }}
                    className="flex w-full items-start gap-3 border-b border-[var(--color-line)] px-4 py-3 text-left last:border-0 hover:bg-white/[0.04]"
                  >
                    <Pill tone={ref.source === "PR" ? "accent" : "neutral"}>{ref.source}</Pill>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-[var(--color-ink)]">
                        #{ref.number} {ref.title}
                      </div>
                      <div className="truncate text-[11px] text-[var(--color-faint)]">
                        {ref.repo} · {ref.state.toLowerCase()}
                        {ref.author ? ` · ${ref.author}` : ""}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Segmented<BoardFilter>
        idBase="board-filter"
        value={filter}
        onChange={onFilter}
        options={[
          { value: "all", label: "All" },
          { value: "mine", label: "Mine" },
          { value: "live", label: "Live" },
        ]}
      />
    </div>
  );
}
