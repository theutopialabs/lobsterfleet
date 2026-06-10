// Buttons. primary = filled accent, ghost = hairline, subtle = bare hover.

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-[var(--color-accent)] text-white shadow-[0_8px_24px_-12px_var(--color-accent)] hover:brightness-110",
  ghost:
    "border border-[var(--color-line)] bg-white/[0.02] text-[var(--color-ink)] hover:bg-white/[0.05]",
  subtle: "text-[var(--color-muted)] hover:bg-white/[0.04] hover:text-[var(--color-ink)]",
  danger:
    "border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/16",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
};

export function Button({
  variant = "ghost",
  size = "md",
  busy = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      disabled={disabled || busy}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

// Square icon-only button.
export function IconButton({
  children,
  label,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}
