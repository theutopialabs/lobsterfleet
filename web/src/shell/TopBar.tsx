// Top bar with breadcrumb, connection pill, the user chip and sign out.

import { LogOut } from "lucide-react";
import { useStore } from "../lib/store";
import { IconButton } from "../components/Button";
import type { Section } from "./Sidebar";

const LABEL: Record<Section, string> = {
  fleet: "fleet",
  board: "board",
  sessions: "sessions",
  admin: "admin",
  settings: "settings",
};

export function TopBar({ section }: { section: Section }) {
  const { connected, user, state, logout } = useStore();
  return (
    <header className="flex h-16 min-w-0 items-center gap-3 border-b border-[var(--color-line)] px-4 md:px-8">
      <div className="min-w-0 truncate text-sm text-[var(--color-faint)]">
        mission control <span className="text-[var(--color-muted)]">/ {LABEL[section]}</span>
      </div>
      {state?.org && (
        <span className="hidden text-xs text-[var(--color-faint)] sm:inline">· {state.org}</span>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-3">
        <span
          className={`flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium md:px-3 ${
            connected
              ? "bg-[var(--color-success)]/12 text-[var(--color-success)]"
              : "bg-[var(--color-danger)]/12 text-[var(--color-danger)]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected
                ? "bg-[var(--color-success)] live-dot shadow-[0_0_6px_currentColor]"
                : "bg-[var(--color-danger)]"
            }`}
          />
          {connected ? "connected" : "offline"}
        </span>
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-[var(--color-line)] py-1 pl-1 pr-2 md:pr-3">
          <div className="grid h-6 w-6 place-items-center rounded-full bg-[var(--color-accent)]/20 text-xs">
            {user?.login?.[0]?.toUpperCase() ?? "?"}
          </div>
          <span className="min-w-0 max-w-24 truncate text-xs text-[var(--color-muted)] md:max-w-40">
            {user?.login ?? "guest"}
          </span>
          {user?.role && (
            <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-faint)]">
              {user.role}
            </span>
          )}
        </div>
        <IconButton label="Sign out" onClick={() => void logout()}>
          <LogOut size={16} strokeWidth={2} />
        </IconButton>
      </div>
    </header>
  );
}
