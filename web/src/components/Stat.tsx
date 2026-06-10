// Big tabular number with a small label. Used in the status strips.

import { motion } from "framer-motion";

export function Stat({
  label,
  value,
  accent = "var(--color-ink)",
  hint,
  index = 0,
}: {
  label: string;
  value: number | string;
  accent?: string;
  hint?: string;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * index, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="glass rounded-2xl p-5"
    >
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-faint)]">{label}</div>
      <div className="mt-2 text-4xl font-semibold tabular-nums" style={{ color: accent }}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-[var(--color-muted)]">{hint}</div>}
    </motion.div>
  );
}
