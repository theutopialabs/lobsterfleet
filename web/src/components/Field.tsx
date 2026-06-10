// Form controls: a labeled Field wrapper plus styled input / select / textarea.

import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
          {label}
        </span>
        {hint && <span className="text-[11px] text-[var(--color-faint)]">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const CONTROL =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-soft)] px-3 py-2.5 text-sm text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]/60 focus:ring-2 focus:ring-[var(--color-accent)]/20";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${CONTROL} ${className}`} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select className={`${CONTROL} appearance-none ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`${CONTROL} resize-none leading-relaxed ${className}`} {...rest} />;
}
