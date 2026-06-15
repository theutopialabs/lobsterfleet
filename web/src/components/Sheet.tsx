// Right-side slide-over drawer with a dimmed backdrop. Used for the
// New crabbox / New card forms.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // close on escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className="glass absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col border-l border-y-0 border-r-0 shadow-[var(--shadow-deep)]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <header className="flex items-start gap-3 border-b border-[var(--color-line)] px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                {subtitle && <p className="mt-0.5 text-sm text-[var(--color-muted)]">{subtitle}</p>}
              </div>
              <IconButton label="Close" onClick={onClose}>
                <X size={16} strokeWidth={2} />
              </IconButton>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-3 border-t border-[var(--color-line)] px-6 py-4">
                {footer}
              </footer>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
