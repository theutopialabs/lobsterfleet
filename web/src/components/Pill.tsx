// Status pills and plain chips.
// StatePill maps a status word to a brand color so the whole app reads the
// same: green = good/live, amber = needs attention, red = bad, gray = idle.

import type { ReactNode } from "react";

type Tone = "success" | "warning" | "danger" | "neutral" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-[var(--color-success)]/12 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/12 text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]/12 text-[var(--color-danger)]",
  accent: "bg-[var(--color-accent)]/14 text-[var(--color-accent-2)]",
  neutral: "bg-white/[0.05] text-[var(--color-muted)]",
};

const DOT_CLASS: Record<Tone, string> = {
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]",
  accent: "bg-[var(--color-accent-2)]",
  neutral: "bg-[var(--color-faint)]",
};

export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// Plain hairline chip for metadata (id, repo, runtime, ...).
export function Chip({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-[var(--color-line)] bg-white/[0.02] px-2 py-0.5 text-[11px] text-[var(--color-muted)] ${
        mono ? "font-mono tabular-nums" : ""
      }`}
    >
      {children}
    </span>
  );
}

// Map any status word we know about to a tone.
export function toneForStatus(status: string): Tone {
  const s = status.toLowerCase();
  if (["ready", "attached", "running", "completed", "done", "active", "ok", "green"].includes(s))
    return "success";
  if (
    ["review", "human review", "provisioning", "pending_adapter", "leasing", "queued", "detached"].includes(
      s,
    )
  )
    return "warning";
  if (["failed", "stopped", "expired", "stalled", "canceled", "error"].includes(s)) return "danger";
  return "neutral";
}

// Pill that picks its color from a status string and shows a live dot for
// active states.
export function StatePill({ status, label }: { status: string; label?: string }) {
  const tone = toneForStatus(status);
  const live = tone === "success" || status.toLowerCase() === "running";
  return (
    <Pill tone={tone}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone]} ${
          live ? "live-dot shadow-[0_0_6px_currentColor]" : ""
        }`}
      />
      {label ?? status}
    </Pill>
  );
}
