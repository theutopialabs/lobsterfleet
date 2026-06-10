// Bottom-right toast stack, fed by the store.

import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "../lib/store";

const TONE: Record<string, string> = {
  ok: "border-[var(--color-success)]/30 text-[var(--color-success)]",
  warn: "border-[var(--color-warning)]/30 text-[var(--color-warning)]",
  error: "border-[var(--color-danger)]/30 text-[var(--color-danger)]",
};

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-80 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            onClick={() => dismissToast(t.id)}
            className={`glass pointer-events-auto rounded-xl border px-4 py-3 text-left text-sm ${TONE[t.tone] ?? TONE.ok}`}
          >
            <span className="text-[var(--color-ink)]">{t.message}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
