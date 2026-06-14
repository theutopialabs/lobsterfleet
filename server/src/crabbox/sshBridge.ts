import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import type { WebSocket } from "ws";
import {
  decodeResizePayload,
  decodeTerminalFrame,
  encodeJsonPayload,
  encodeTerminalFrame,
  TerminalMessageType,
} from "../core/terminal-protocol.js";

// Bridges a live SSH PTY on a leased crabbox to a terminal websocket.
// ssh stdout/stderr -> Output frames. ws Input -> stream.write. Resize -> setWindow.
// Either side closing tears down both.

export type SshTarget = {
  host: string;
  port: number;
  user: string;
  privateKeyPath: string;
};

export type BridgeOpts = {
  cols?: number;
  rows?: number;
  // Read-only viewers can watch output but cannot write to the PTY.
  allowInput?: boolean;
  // Run this in the PTY instead of a plain login shell. Used to land attaches
  // in the box's tmux session (with a shell fallback inside the command).
  command?: string;
  // Called once the ssh stream is up, handy for logging.
  onReady?: () => void;
  // Called when the bridge fully tears down (either side closed).
  onClose?: () => void;
  // The pinned host key hash for this box, or null if we have not seen it (TOFU).
  knownHostKey?: string | null;
  // Called on first connect with the box's host key hash so the caller pins it.
  onLearnHostKey?: (hostKeyHash: string) => void;
};

// Constant-time compare of two hex strings. Different lengths is an easy no.
function hostKeyMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function sendEvent(ws: WebSocket, sessionId: string, type: string, message: string): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(
    encodeTerminalFrame({
      type: TerminalMessageType.Event,
      sessionId,
      payload: encodeJsonPayload({ type, message }),
    }),
  );
}

function sendError(ws: WebSocket, sessionId: string, message: string): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(
    encodeTerminalFrame({
      type: TerminalMessageType.Error,
      sessionId,
      payload: encodeJsonPayload({ message }),
    }),
  );
}

// Wires one ws to one ssh shell. Returns a teardown fn so callers can kill it
// (eg when the lease is released). Safe to call teardown more than once.
export function attachSshBridge(
  ws: WebSocket,
  sessionId: string,
  target: SshTarget,
  opts: BridgeOpts = {},
): () => void {
  const conn = new Client();
  let closed = false;
  // Flipped false when the host key check rejects, so we do not also surface the
  // noisy generic handshake error that ssh2 emits right after.
  let hostKeyOk = true;
  let shellStream: import("ssh2").ClientChannel | null = null;

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    opts.onClose?.();
    try {
      shellStream?.end();
    } catch {
      // already gone
    }
    try {
      conn.end();
    } catch {
      // already gone
    }
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      try {
        ws.close();
      } catch {
        // already closing
      }
    }
  };

  let privateKey: Buffer;
  try {
    privateKey = readFileSync(target.privateKeyPath);
  } catch (error) {
    sendError(ws, sessionId, `cannot read ssh key: ${String(error)}`);
    teardown();
    return teardown;
  }

  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const allowInput = opts.allowInput ?? true;

  conn.on("ready", () => {
    const pty = { term: "xterm-256color", cols, rows };
    const onStream = (err: Error | undefined, stream: import("ssh2").ClientChannel | undefined): void => {
      if (err || !stream) {
        sendError(ws, sessionId, `shell open failed: ${err ? err.message : "no stream"}`);
        teardown();
        return;
      }
      shellStream = stream;
      opts.onReady?.();
      sendEvent(ws, sessionId, "ready", "ssh terminal connected");

      // box -> ws as Output frames (stdout and stderr both flow here)
      stream.on("data", (chunk: Buffer) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(
          encodeTerminalFrame({
            type: TerminalMessageType.Output,
            sessionId,
            payload: new Uint8Array(chunk),
          }),
        );
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(
          encodeTerminalFrame({
            type: TerminalMessageType.Output,
            sessionId,
            payload: new Uint8Array(chunk),
          }),
        );
      });

      stream.on("close", () => {
        sendEvent(ws, sessionId, "exit", "ssh session closed");
        teardown();
      });
    };
    if (opts.command) {
      conn.exec(opts.command, { pty }, onStream);
    } else {
      conn.shell(pty, onStream);
    }
  });

  conn.on("error", (err) => {
    // Host key mismatch already sent a clear message, skip the generic one.
    if (hostKeyOk) sendError(ws, sessionId, `ssh error: ${err.message}`);
    teardown();
  });
  conn.on("close", () => teardown());

  // ws -> box. Input writes to the shell, Resize sets the pty window.
  ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    const bytes = toBytes(data);
    if (!bytes) return;
    const frame = decodeTerminalFrame(bytes);
    if (!frame) return;
    if (frame.type === TerminalMessageType.Input) {
      if (!allowInput) return;
      shellStream?.write(Buffer.from(frame.payload));
    } else if (frame.type === TerminalMessageType.Resize) {
      if (!allowInput) return;
      const size = decodeResizePayload(frame.payload);
      if (size && shellStream) {
        // ssh2 setWindow takes (rows, cols, height, width)
        shellStream.setWindow(size.rows, size.cols, 0, 0);
      }
    } else if (frame.type === TerminalMessageType.Stop) {
      teardown();
    }
  });
  ws.on("close", () => teardown());
  ws.on("error", () => teardown());

  // Host key check, trust on first use. ssh2 hands us the sha256 hash of the
  // box's host key. First time for this lease we pin it, after that we verify.
  // A mismatch means someone swapped the box under us, so we refuse.
  conn.connect({
    host: target.host,
    port: target.port,
    username: target.user,
    privateKey,
    readyTimeout: 30_000,
    keepaliveInterval: 15_000,
    hostHash: "sha256",
    hostVerifier: (data: Buffer | string): boolean => {
      // With hostHash set ssh2 passes the hex digest, but type it defensively.
      const hashedKey = typeof data === "string" ? data : data.toString("hex");
      const known = opts.knownHostKey ?? null;
      if (!known) {
        opts.onLearnHostKey?.(hashedKey);
        return true;
      }
      if (hostKeyMatches(known, hashedKey)) return true;
      hostKeyOk = false;
      sendError(ws, sessionId, "ssh host key changed, refusing to connect");
      return false;
    },
  });

  return teardown;
}

// ws data can arrive as a Buffer, an ArrayBuffer, or a list of Buffers.
function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array | null {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return null;
}
