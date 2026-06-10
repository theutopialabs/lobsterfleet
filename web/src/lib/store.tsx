// App store. Polls /api/state every 15s, tracks connection + auth, and
// exposes a refresh() plus a tiny toast system the whole app can use.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, endpoints } from "./api";
import type { AuthMethods, ServerState, User } from "./api";

const POLL_MS = 15000;
// poll faster while a box is provisioning so the tile flips to live promptly
const POLL_FAST_MS = 5000;

export type Toast = { id: number; message: string; tone: "ok" | "warn" | "error" };

type StoreValue = {
  state: ServerState | null;
  user: User | null;
  auth: AuthMethods | null;
  connected: boolean;
  // true once the server told us we are not signed in
  unauthenticated: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  tokenLogin: (token: string) => Promise<void>;
  devLogin: (id: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  toasts: Toast[];
  toast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState | null>(null);
  const [auth, setAuth] = useState<AuthMethods | null>(null);
  const [connected, setConnected] = useState(false);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    // auto dismiss after a few seconds
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const provisioningRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await endpoints.state();
      provisioningRef.current = (data.interactiveSessions ?? []).some((s) =>
        ["provisioning", "pending_adapter"].includes(s.status),
      );
      setState(data);
      setAuth(data.auth);
      setConnected(true);
      setUnauthenticated(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const authState = await endpoints.auth().catch(() => null);
        if (authState) setAuth(authState.auth);
        setUnauthenticated(true);
        setConnected(true); // server is reachable, we just are not logged in
      } else {
        setConnected(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const tokenLogin = useCallback(
    async (token: string) => {
      await endpoints.tokenLogin(token);
      await refresh();
    },
    [refresh],
  );

  const devLogin = useCallback(
    async (id: string, name: string) => {
      await endpoints.devLogin(id, name, "owner");
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await endpoints.logout().catch(() => undefined);
    // drop everything we knew and land on the sign-in gate
    setState(null);
    setUnauthenticated(true);
    const authState = await endpoints.auth().catch(() => null);
    if (authState) setAuth(authState.auth);
  }, []);

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(async () => {
        await refresh();
        tick();
      }, provisioningRef.current ? POLL_FAST_MS : POLL_MS);
    };
    tick();
    return () => clearTimeout(timer);
  }, [refresh]);

  const value: StoreValue = {
    state,
    user: state?.user ?? null,
    auth: state?.auth ?? auth,
    connected,
    unauthenticated,
    loading,
    refresh,
    tokenLogin,
    devLogin,
    logout,
    toasts,
    toast,
    dismissToast,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
