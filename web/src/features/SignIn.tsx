// Minimal sign-in gate. Shows when the server says we are not authenticated.
// In a self-hosted dev setup the dev identity login is the quick path in.

import { useState } from "react";
import { motion } from "framer-motion";
import { Shell } from "lucide-react";
import { endpoints } from "../lib/api";
import { useStore } from "../lib/store";
import { Button } from "../components/Button";
import { Field, Input } from "../components/Field";

export function SignIn() {
  const { auth, devLogin, tokenLogin, toast } = useStore();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  // per-method busy so one pending login does not lock the other button
  const [busy, setBusy] = useState<"dev" | "token" | null>(null);

  const goDev = async () => {
    if (!id.trim()) {
      toast("Pick a handle", "warn");
      return;
    }
    setBusy("dev");
    try {
      await devLogin(id.trim(), name.trim() || id.trim());
    } catch {
      toast("Dev login is disabled on this server", "error");
    } finally {
      setBusy(null);
    }
  };

  const goToken = async () => {
    if (!token.trim()) {
      toast("Enter the bootstrap token", "warn");
      return;
    }
    setBusy("token");
    try {
      await tokenLogin(token.trim());
    } catch {
      toast("Invalid bootstrap token", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid h-full w-full place-items-center px-4">
      <div className="aurora" />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="glass w-full max-w-sm min-w-0 rounded-2xl p-5 shadow-[var(--shadow-deep)] sm:p-7"
      >
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)] shadow-[0_0_28px_-8px_var(--color-accent)]">
            <Shell size={21} strokeWidth={2.2} />
          </div>
          <span className="brand-gradient text-xl font-semibold tracking-tight">lobsterfleet</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Mission control</h1>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">
          Lease boxes, attach a terminal, run agents. Your fleet, your hardware.
        </p>
        <div className="mt-6 flex flex-col gap-4">
          {auth?.token && (
            <div className="flex flex-col gap-3">
              <Field label="Bootstrap token">
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && goToken()}
                  placeholder="token"
                  type="password"
                />
              </Field>
              <Button variant="primary" busy={busy === "token"} onClick={goToken} className="w-full">
                Enter mission control
              </Button>
            </div>
          )}

          {auth?.devIdentity && (
            <div className="flex flex-col gap-3 border-t border-[var(--color-line)] pt-4">
              <Field label="Handle">
                <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="vishnu" />
              </Field>
              <Field label="Name" hint="optional">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vishnu" />
              </Field>
              <Button variant={auth?.token ? "ghost" : "primary"} busy={busy === "dev"} onClick={goDev} className="w-full">
                Use local identity
              </Button>
            </div>
          )}

          {auth?.github && (
            <Button
              variant="ghost"
              onClick={() => (window.location.href = endpoints.githubLoginUrl())}
              className="w-full"
            >
              Continue with GitHub
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
