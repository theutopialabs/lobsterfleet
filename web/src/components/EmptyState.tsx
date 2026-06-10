// Tasteful empty state for when a view has nothing to show.

import type { ReactNode } from "react";

export function EmptyState({
  glyph = "◍",
  title,
  body,
  action,
}: {
  glyph?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass grid place-items-center rounded-2xl px-6 py-20 text-center">
      <div className="text-5xl opacity-25">{glyph}</div>
      <div className="mt-4 text-lg font-medium">{title}</div>
      {body && <div className="mt-1.5 max-w-sm text-sm text-[var(--color-muted)]">{body}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
