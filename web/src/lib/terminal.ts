// Browser side of the terminal frame protocol. This is the tiny binary framing
// the server uses over /api/terminal/ws (see server terminal-protocol.ts). We
// reimplement the few bits the UI needs so we do not pull in server code.

export const TERMINAL_WS_MAGIC = 0x5943;
export const TERMINAL_WS_VERSION = 1;

// Message type tags. Same numbers as the server.
export const T = {
  Hello: 1,
  Welcome: 2,
  Subscribe: 10,
  Unsubscribe: 11,
  Output: 20,
  Snapshot: 21,
  Event: 22,
  Error: 23,
  Input: 30,
  Resize: 32,
  Ping: 60,
  Pong: 61,
} as const;

// Subscribe flags. Ask for live output, an initial snapshot, and events.
export const SubFlags = {
  Output: 1 << 0,
  Snapshot: 1 << 1,
  Events: 1 << 2,
} as const;

export type Frame = { type: number; sessionId: string; payload: Uint8Array };

const enc = new TextEncoder();
const dec = new TextDecoder();

// Pack a frame: magic, version, type, sessionId, payload.
export function encodeFrame(
  type: number,
  sessionId = "",
  payload: Uint8Array<ArrayBufferLike> = new Uint8Array(),
): Uint8Array<ArrayBuffer> {
  const idBytes = enc.encode(sessionId);
  const out = new Uint8Array(2 + 1 + 1 + 4 + idBytes.length + 4 + payload.length);
  const view = new DataView(out.buffer);
  let off = 0;
  view.setUint16(off, TERMINAL_WS_MAGIC, true);
  off += 2;
  view.setUint8(off, TERMINAL_WS_VERSION);
  off += 1;
  view.setUint8(off, type);
  off += 1;
  view.setUint32(off, idBytes.length, true);
  off += 4;
  out.set(idBytes, off);
  off += idBytes.length;
  view.setUint32(off, payload.length, true);
  off += 4;
  out.set(payload, off);
  return out;
}

// Unpack a frame, or null if it is not one of ours.
export function decodeFrame(data: Uint8Array): Frame | null {
  if (data.byteLength < 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 0;
  if (view.getUint16(off, true) !== TERMINAL_WS_MAGIC) return null;
  off += 2;
  if (view.getUint8(off) !== TERMINAL_WS_VERSION) return null;
  off += 1;
  const type = view.getUint8(off);
  off += 1;
  const idLen = view.getUint32(off, true);
  off += 4;
  if (off + idLen + 4 > data.byteLength) return null;
  const sessionId = dec.decode(data.subarray(off, off + idLen));
  off += idLen;
  const payLen = view.getUint32(off, true);
  off += 4;
  if (off + payLen > data.byteLength) return null;
  return { type, sessionId, payload: data.subarray(off, off + payLen) };
}

// Subscribe payload: flags + two snapshot intervals + optional cols/rows.
export function encodeSubscribePayload(flags: number, cols?: number, rows?: number): Uint8Array {
  const hasSize = cols !== undefined && rows !== undefined;
  const payload = new Uint8Array(hasSize ? 20 : 12);
  const view = new DataView(payload.buffer);
  view.setUint32(0, flags >>> 0, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, 0, true);
  if (hasSize) {
    view.setUint32(12, cols ?? 0, true);
    view.setUint32(16, rows ?? 0, true);
  }
  return payload;
}

export function encodeResizePayload(cols: number, rows: number): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, cols >>> 0, true);
  view.setUint32(4, rows >>> 0, true);
  return payload;
}

export function decodeJson<T>(payload: Uint8Array): T | null {
  try {
    return JSON.parse(dec.decode(payload)) as T;
  } catch {
    return null;
  }
}

// xterm theme tuned to our tokens (deep space bg, light ink, accent cursor).
export const XTERM_THEME = {
  background: "#0b0d12",
  foreground: "#f4f6fb",
  cursor: "#28c8ff",
  cursorAccent: "#0b0d12",
  selectionBackground: "rgba(109,94,252,0.35)",
  black: "#0b0d12",
  red: "#fb6f84",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#6d5efc",
  magenta: "#9d7bff",
  cyan: "#28c8ff",
  white: "#f4f6fb",
  brightBlack: "#5b6373",
  brightRed: "#fb6f84",
  brightGreen: "#34d399",
  brightYellow: "#fbbf24",
  brightBlue: "#6d5efc",
  brightMagenta: "#9d7bff",
  brightCyan: "#28c8ff",
  brightWhite: "#ffffff",
};
