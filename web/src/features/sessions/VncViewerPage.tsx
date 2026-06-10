// Full-screen desktop viewer for a GUI crabbox. Opens in its own tab from the
// "VNC" button. It connects noVNC straight to our own ws bridge
// (/api/interactive-sessions/<id>/vnc), which ssh-tunnels to the box's desktop
// and has already done the VNC auth, so the browser sees a no-auth RFB stream.

import { useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";

type Status = "connecting" | "connected" | "disconnected" | "error";

function wsUrlFor(id: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/interactive-sessions/${encodeURIComponent(id)}/vnc`;
}

export function VncViewerPage({ id }: { id: string }) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    const target = screenRef.current;
    if (!target) return;

    let rfb: InstanceType<typeof RFB> | null = null;
    try {
      rfb = new RFB(target, wsUrlFor(id), {});
      rfb.scaleViewport = true;
      rfb.background = "#06070a";
    } catch (err) {
      setStatus("error");
      setDetail(err instanceof Error ? err.message : "could not start viewer");
      return;
    }

    const onConnect = () => setStatus("connected");
    const onDisconnect = (e: CustomEvent<{ clean: boolean }>) => {
      setStatus(e.detail?.clean ? "disconnected" : "error");
      if (!e.detail?.clean) setDetail("connection dropped (is the desktop still up?)");
    };
    const onSecurityFailure = (e: CustomEvent<{ reason?: string }>) => {
      setStatus("error");
      setDetail(e.detail?.reason || "the box rejected the VNC auth");
    };

    rfb.addEventListener("connect", onConnect);
    rfb.addEventListener("disconnect", onDisconnect as EventListener);
    rfb.addEventListener("securityfailure", onSecurityFailure as EventListener);

    return () => {
      rfb?.removeEventListener("connect", onConnect);
      rfb?.removeEventListener("disconnect", onDisconnect as EventListener);
      rfb?.removeEventListener("securityfailure", onSecurityFailure as EventListener);
      try {
        rfb?.disconnect();
      } catch {
        // already gone
      }
    };
  }, [id]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
      <header className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 text-sm">
        <span className="font-semibold tracking-tight">Desktop</span>
        <code className="text-xs text-[var(--color-faint)]">{id}</code>
        <span className="ml-auto flex items-center gap-2 text-xs text-[var(--color-muted)]">
          <span
            className={`h-2 w-2 rounded-full ${
              status === "connected"
                ? "bg-emerald-400"
                : status === "error"
                  ? "bg-red-400"
                  : "bg-amber-400"
            }`}
          />
          {status === "connecting" && "connecting"}
          {status === "connected" && "live"}
          {status === "disconnected" && "closed"}
          {status === "error" && (detail || "error")}
        </span>
      </header>
      <div ref={screenRef} className="min-h-0 flex-1" />
      {status !== "connected" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
            {status === "connecting" && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            <span>
              {status === "connecting" && "connecting to desktop"}
              {status === "disconnected" && "desktop session closed"}
              {status === "error" && (detail || "could not reach the desktop")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
