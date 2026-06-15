// Left nav rail.

import { motion } from "framer-motion";
import {
  LayoutDashboard,
  KanbanSquare,
  SquareTerminal,
  ShieldCheck,
  Settings2,
  Shell,
  type LucideIcon,
} from "lucide-react";

export type Section = "fleet" | "board" | "sessions" | "admin" | "settings";

const NAV: { id: Section; label: string; icon: LucideIcon; ready: boolean }[] = [
  { id: "fleet", label: "Fleet", icon: LayoutDashboard, ready: true },
  { id: "board", label: "Board", icon: KanbanSquare, ready: true },
  { id: "sessions", label: "Sessions", icon: SquareTerminal, ready: true },
  { id: "admin", label: "Admin", icon: ShieldCheck, ready: true },
  { id: "settings", label: "Settings", icon: Settings2, ready: true },
];

export function Sidebar({
  section,
  onSelect,
}: {
  section: Section;
  onSelect: (s: Section) => void;
}) {
  return (
    <aside className="glass flex w-full shrink-0 items-center gap-1 overflow-x-auto border-x-0 border-t-0 px-3 py-3 md:w-[224px] md:flex-col md:items-stretch md:overflow-visible md:border-y-0 md:border-l-0 md:px-4 md:py-5">
      <div className="mr-2 flex shrink-0 items-center gap-2.5 px-2 md:mb-7 md:mr-0">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)] shadow-[0_0_24px_-8px_var(--color-accent)]">
          <Shell size={19} strokeWidth={2.2} />
        </div>
        <span className="brand-gradient hidden text-lg font-semibold tracking-tight sm:inline">
          lobsterfleet
        </span>
      </div>
      {NAV.map((item) => {
        const active = item.id === section;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            aria-label={item.label}
            title={item.label}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(item.id)}
            className={`group relative flex h-10 w-10 shrink-0 items-center justify-center gap-3 rounded-lg text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 active:scale-[0.97] sm:w-auto sm:justify-start sm:px-3 sm:py-2 ${
              active
                ? "bg-[var(--color-accent)]/12 text-[var(--color-ink)]"
                : "text-[var(--color-muted)] hover:bg-white/[0.04] hover:text-[var(--color-ink)]"
            }`}
          >
            <Icon
              size={18}
              strokeWidth={active ? 2.4 : 2}
              className={`shrink-0 transition-colors ${
                active ? "text-[var(--color-accent-2)]" : "text-current group-hover:text-[var(--color-accent-2)]"
              }`}
            />
            <span className="hidden text-sm font-medium sm:inline">{item.label}</span>
            {!item.ready && (
              <span className="ml-auto rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-faint)]">
                soon
              </span>
            )}
            {active && item.ready && (
              <motion.span
                layoutId="nav-dot"
                className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-accent-2)] shadow-[0_0_8px_var(--color-accent-2)] sm:static sm:ml-auto"
              />
            )}
          </button>
        );
      })}
      <div className="mt-auto hidden px-2 pt-4 text-[11px] text-[var(--color-faint)] md:block">
        self-hosted · LXC
      </div>
    </aside>
  );
}
