// App shell. Sidebar + top bar + animated view switch. Wraps everything in
// the store provider and gates on auth.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./lib/store";
import { ApiError, endpoints } from "./lib/api";
import type { InteractiveSession } from "./lib/api";
import { Sidebar } from "./shell/Sidebar";
import type { Section } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { Toasts } from "./components/Toasts";
import { FleetView } from "./features/fleet/FleetView";
import { BoardView } from "./features/board/BoardView";
import { SessionsView } from "./features/sessions/SessionsView";
import { SessionTile } from "./features/sessions/SessionTile";
import { AdminView } from "./features/admin/AdminView";
import { SettingsView } from "./features/settings/SettingsView";
import { SignIn } from "./features/SignIn";
import { VncViewerPage } from "./features/sessions/VncViewerPage";

export function App() {
  const sharedRoute = sharedSessionRoute(window.location);
  if (sharedRoute) return <SharedSessionPage id={sharedRoute.id} token={sharedRoute.token} />;

  // Standalone desktop viewer tab. Auth rides the same-origin cookie on the ws.
  const vnc = vncRoute(window.location);
  if (vnc) return <VncViewerPage id={vnc.id} />;

  return (
    <StoreProvider>
      <Shell />
      <Toasts />
    </StoreProvider>
  );
}

function Shell() {
  const { unauthenticated, loading } = useStore();
  const [section, setSection] = useState<Section>(() => sectionFromPath(window.location.pathname));

  useEffect(() => {
    const onPop = () => setSection(sectionFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const selectSection = (next: Section) => {
    setSection(next);
    const path = pathForSection(next);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  };

  if (loading) return <Booting />;
  if (unauthenticated) return <SignIn />;

  return (
    <div className="flex h-full flex-col text-[15px] md:flex-row">
      <div className="aurora" />
      <Sidebar section={section} onSelect={selectSection} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar section={section} />
        <div className="min-h-0 flex-1 overflow-auto px-4 py-5 md:px-8 md:py-7">
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <View section={section} onSelect={selectSection} />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function sharedSessionRoute(location: Location): { id: string; token: string } | null {
  const match = location.pathname.match(/^\/sessions\/([^/]+)$/);
  if (!match) return null;
  const token = new URLSearchParams(location.search).get("token") ?? "";
  if (!token) return null;
  return { id: decodeURIComponent(match[1] ?? ""), token };
}

function vncRoute(location: Location): { id: string } | null {
  const match = location.pathname.match(/^\/vnc\/([^/]+)$/);
  return match ? { id: decodeURIComponent(match[1] ?? "") } : null;
}

function sectionFromPath(pathname: string): Section {
  const key = pathname.replace(/^\/+/, "").split("/")[0];
  if (key === "board" || key === "sessions" || key === "admin" || key === "settings") return key;
  return "fleet";
}

function pathForSection(section: Section): string {
  return section === "fleet" ? "/" : `/${section}`;
}

function View({ section, onSelect }: { section: Section; onSelect: (section: Section) => void }) {
  if (section === "fleet") return <FleetView onOpenSessions={() => onSelect("sessions")} />;
  if (section === "board") return <BoardView />;
  if (section === "sessions") return <SessionsView />;
  if (section === "admin") return <AdminView />;
  return <SettingsView />;
}

function SharedSessionPage({ id, token }: { id: string; token: string }) {
  const [session, setSession] = useState<InteractiveSession | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setSession(null);
    setError("");
    endpoints
      .sharedSession(id, token)
      .then(({ session }) => {
        if (alive) setSession({ ...session, sharedReadOnly: true });
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "Shared session unavailable");
      });
    return () => {
      alive = false;
    };
  }, [id, token]);

  return (
    <div className="min-h-full bg-[var(--color-bg)] px-4 py-5 text-[15px] md:px-8 md:py-7">
      <div className="aurora" />
      <div className="w-full">
        <div className="mb-5">
          <div className="text-xs uppercase tracking-[0.22em] text-[var(--color-faint)]">
            read-only share
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
            Shared session
          </h1>
        </div>
        {session ? (
          <SessionTile
            session={session}
            index={0}
            maximized
            onMaximize={() => undefined}
            onLogs={() => undefined}
            shareToken={token}
            showActions={false}
          />
        ) : (
          <div className="glass grid min-h-[360px] place-items-center rounded-2xl">
            <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
              {!error && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              <span>{error || "loading shared session"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Booting() {
  return (
    <div className="grid h-full place-items-center">
      <div className="aurora" />
      <div className="flex items-center gap-3 text-[var(--color-muted)]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        starting mission control
      </div>
    </div>
  );
}
