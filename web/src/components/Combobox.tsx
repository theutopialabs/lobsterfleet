// One text box that doubles as a picker. Type and it filters the option list
// after a short pause, arrow keys + enter to pick. Free text is allowed too,
// the server validates whatever ends up submitted.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

// don't render thousands of rows, the footer nudges people to keep typing
const MAX_VISIBLE = 120;
const DEBOUNCE_MS = 300;

export function Combobox({
  value,
  onChange,
  options,
  loading = false,
  placeholder,
  pinned,
  pinnedLabel = "in use",
  renderOption,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  loading?: boolean;
  placeholder?: string;
  pinned?: string[]; // rows that get the small pill
  pinnedLabel?: string;
  renderOption?: (option: string, needle: string) => ReactNode;
  // fires on Enter once the panel is settled (closed, or open with no match)
  onSubmit?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const [dirty, setDirty] = useState(false); // typed since last pick/focus
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedSet = useMemo(() => new Set(pinned ?? []), [pinned]);

  // filter a beat after typing stops, not on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(dirty ? value.trim().toLowerCase() : ""), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, dirty]);

  const matches = useMemo(
    () => (needle ? options.filter((r) => r.includes(needle)) : options),
    [options, needle],
  );
  const visible = matches.slice(0, MAX_VISIBLE);

  // keep the highlighted row valid and in view as the list changes
  useEffect(() => {
    setActive(0);
  }, [needle]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (option: string) => {
    onChange(option);
    setDirty(false);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) {
      if (e.key === "Enter" && onSubmit) {
        e.preventDefault();
        onSubmit(value);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visible[active]) {
        pick(visible[active]);
      } else {
        // keep whatever was typed
        setOpen(false);
        onSubmit?.(value);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setDirty(true);
          setOpen(true);
        }}
        onFocus={() => {
          setDirty(false);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? (loading ? "Loading…" : "type to search")}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-soft)] py-2.5 pl-3 pr-16 font-mono text-sm text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]/60 focus:ring-2 focus:ring-[var(--color-accent)]/20"
      />
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
        {loading ? (
          <span className="h-3 w-3 animate-spin rounded-full border border-[var(--color-faint)] border-t-transparent" />
        ) : (
          options.length > 0 && <span className="tabular-nums">{options.length.toLocaleString()}</span>
        )}
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            // keep focus in the input so blur doesn't beat option clicks
            onMouseDown={(e) => e.preventDefault()}
            // wider than the input so long values don't truncate
            className="absolute left-0 top-full z-30 mt-1.5 w-max min-w-full max-w-[26rem] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-panel)_94%,transparent)] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-md"
          >
            <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
              {visible.length === 0 && (
                <div className="px-3 py-2.5 text-xs text-[var(--color-faint)]">
                  {loading ? "Loading…" : "No matches. Enter keeps what you typed."}
                </div>
              )}
              {visible.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  data-index={index}
                  onClick={() => pick(option)}
                  onMouseMove={() => setActive(index)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[13px] transition-colors ${
                    index === active
                      ? "bg-[var(--color-accent)]/15 text-[var(--color-ink)]"
                      : "text-[var(--color-muted)]"
                  }`}
                >
                  {renderOption ? (
                    renderOption(option, needle)
                  ) : (
                    <span className="min-w-0 truncate">
                      <Highlight text={option} needle={needle} />
                    </span>
                  )}
                  {pinnedSet.has(option) && (
                    <span className="ml-auto shrink-0 rounded-full bg-[var(--color-success)]/10 px-1.5 py-px text-[10px] font-sans text-[var(--color-success)]">
                      {pinnedLabel}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {matches.length > MAX_VISIBLE && (
              <div className="border-t border-[var(--color-line-soft)] px-3 py-1.5 text-[11px] text-[var(--color-faint)]">
                {(matches.length - MAX_VISIBLE).toLocaleString()} more. Keep typing to narrow.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// underlights the matched part in accent, leaves the rest alone
export function Highlight({
  text,
  needle,
  className = "",
}: {
  text: string;
  needle: string;
  className?: string;
}) {
  const at = needle ? text.indexOf(needle) : -1;
  if (at < 0) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {text.slice(0, at)}
      <span className="rounded-sm bg-[var(--color-accent-2)]/20 text-[var(--color-accent-2)]">
        {text.slice(at, at + needle.length)}
      </span>
      {text.slice(at + needle.length)}
    </span>
  );
}
