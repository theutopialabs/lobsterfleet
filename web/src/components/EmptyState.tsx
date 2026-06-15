// Tasteful empty state for when a view has nothing to show.

import type { ReactNode } from "react";

export function EmptyState({
  icon,
  glyph,
  title,
  body,
  action,
}: {
  // Prefer a Lucide icon; glyph is the legacy text fallback.
  icon?: ReactNode;
  glyph?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass relative grid place-items-center overflow-hidden rounded-2xl px-6 py-20 text-center">
      {/* faint coral wash so the empty state feels aspirational, not bleak */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(28rem_12rem_at_50%_-30%,var(--color-accent)/10,transparent_70%)]" />
      <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[var(--color-line)] bg-white/[0.02] text-[var(--color-accent-2)] shadow-[var(--shadow-soft)]">
        {icon ?? <span className="text-3xl opacity-50">{glyph ?? "◍"}</span>}
      </div>
      <div className="mt-5 text-lg font-semibold tracking-tight">{title}</div>
      {body && <div className="mt-1.5 max-w-sm text-sm text-[var(--color-muted)]">{body}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
