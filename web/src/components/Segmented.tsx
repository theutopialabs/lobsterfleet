// Segmented control with a sliding active pill (shared layoutId).

import { motion } from "framer-motion";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  idBase,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  // unique base so multiple segmented controls do not share the pill
  idBase: string;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-soft)] p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`relative rounded-lg px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 ${
              active ? "text-[var(--color-ink)]" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${idBase}`}
                className="absolute inset-0 rounded-lg bg-white/[0.07]"
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
