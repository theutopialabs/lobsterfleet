// Live terminal tile body. Mounts an xterm.js instance and bridges it to the
// /api/terminal/ws hub using the binary frame protocol.
//
// Flow: open ws -> send Hello -> on Welcome send Subscribe(sessionId, flags,
// cols/rows). Server replies Event{type:"subscribed",canInput} then streams
// Output bytes (write to term) and Event json (status). term.onData -> Input
// frames, term.onResize -> Resize frames.

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  SubFlags,
  T,
  XTERM_THEME,
  decodeFrame,
  decodeJson,
  encodeFrame,
  encodeResizePayload,
  encodeSubscribePayload,
} from "../../lib/terminal";

type ConnState = "connecting" | "subscribed" | "closed" | "error";

// status events the server sends inside Event frames
type TermEvent = {
  type: string;
  canInput?: boolean;
  message?: string;
  reason?: string;
};

export function Terminal({
  sessionId,
  readOnly = false,
  shareToken,
  onStatus,
}: {
  sessionId: string;
  // read-only watchers do not send input or resize
  readOnly?: boolean;
  shareToken?: string;
  onStatus?: (state: ConnState, note?: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string>("opening bridge...");
  const [state, setState] = useState<ConnState>("connecting");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      convertEol: true,
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      theme: XTERM_THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // host not laid out yet, the resize observer will catch up
    }

    let canInput = false;
    let alive = true;
    // local mirror of conn state so the close handler does not read stale react state
    let lastState: ConnState = "connecting";
    let ws: WebSocket | null = null;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let everSubscribed = false;

    const setStatus = (next: ConnState, n?: string) => {
      if (!alive) return;
      lastState = next;
      setState(next);
      if (n !== undefined) setNote(n);
      onStatus?.(next, n);
    };

    // a dropped bridge comes back on its own: exponential backoff, capped at 15s
    const scheduleReconnect = () => {
      if (!alive || retryTimer) return;
      const delay = Math.min(15000, 1000 * 2 ** retries);
      retries += 1;
      setStatus("connecting", retries > 1 ? `reconnecting (try ${retries})...` : "reconnecting...");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (alive) connect();
      }, delay);
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const wsUrl = new URL(`${proto}://${location.host}/api/terminal/ws`);
      if (shareToken) {
        wsUrl.searchParams.set("shareSession", sessionId);
        wsUrl.searchParams.set("token", shareToken);
      }
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";
      ws = socket;

      const sendSubscribe = () => {
        // the server replays a snapshot on subscribe; start from a clean
        // screen on reconnects so scrollback is not duplicated
        if (everSubscribed) term.reset();
        const flags = SubFlags.Output | SubFlags.Snapshot | SubFlags.Events;
        const payload = encodeSubscribePayload(flags, term.cols, term.rows);
        socket.send(encodeFrame(T.Subscribe, sessionId, payload));
      };

      socket.onopen = () => {
        socket.send(encodeFrame(T.Hello));
      };

      socket.onmessage = (event) => {
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        const frame = decodeFrame(bytes);
        if (!frame) return;

        if (frame.type === T.Welcome) {
          sendSubscribe();
          return;
        }
        // only handle frames for our session from here on
        if (frame.sessionId && frame.sessionId !== sessionId) return;

        if (frame.type === T.Output || frame.type === T.Snapshot) {
          term.write(frame.payload);
          return;
        }
        if (frame.type === T.Event) {
          const ev = decodeJson<TermEvent>(frame.payload);
          if (!ev) return;
          if (ev.type === "subscribed") {
            retries = 0;
            everSubscribed = true;
            canInput = !readOnly && Boolean(ev.canInput);
            setStatus("subscribed", canInput ? undefined : "view only");
            // push our real size once attached, but only if input is granted
            if (canInput) {
              socket.send(encodeFrame(T.Resize, sessionId, encodeResizePayload(term.cols, term.rows)));
            }
          } else if (ev.type === "subscribing") {
            setStatus("connecting", "leasing a box...");
          } else if (ev.type === "notice") {
            const message = ev.message || "terminal unavailable";
            if (message.includes("provisioning") || message.includes("warming")) {
              setStatus("connecting", message);
            } else {
              setStatus("error", message);
              socket.close(1000, "terminal unavailable");
            }
          } else if (ev.type === "closed") {
            setStatus("closed", ev.reason || "session closed");
          } else if (ev.type === "exit") {
            setStatus("closed", ev.message || "ssh session closed");
          } else if (ev.type === "warning") {
            setNote(ev.message || "warning");
          }
          return;
        }
        if (frame.type === T.Error) {
          const ev = decodeJson<{ error?: string }>(frame.payload);
          setStatus("error", ev?.error || "terminal error");
          return;
        }
      };

      // errors always come with a close; let onclose decide whether to retry
      socket.onclose = () => {
        canInput = false;
        // server said closed/error: that's final. anything else was a drop.
        if (alive && lastState !== "error" && lastState !== "closed") {
          scheduleReconnect();
        }
      };
    };

    connect();

    // user keystrokes -> Input frames
    const dataSub = term.onData((data) => {
      if (!canInput || ws?.readyState !== WebSocket.OPEN) return;
      ws.send(encodeFrame(T.Input, sessionId, new TextEncoder().encode(data)));
    });

    // term resize -> Resize frames
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (!canInput || ws?.readyState !== WebSocket.OPEN) return;
      ws.send(encodeFrame(T.Resize, sessionId, encodeResizePayload(cols, rows)));
    });

    // keep xterm sized to its container
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // container hidden, ignore
      }
    });
    ro.observe(host);

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      ro.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodeFrame(T.Unsubscribe, sessionId));
          ws.close(1000, "tile closed");
        } else {
          ws.close();
        }
      }
      term.dispose();
    };
    // re-bridge only when the session or mode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, readOnly, shareToken]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {state !== "subscribed" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--color-bg-soft)]/70 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            {state === "connecting" && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            <span>{note}</span>
          </div>
        </div>
      )}
    </div>
  );
}
