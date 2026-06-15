// Tiny ws test client for the terminal bridge. Connects to /api/terminal/ws,
// sends a Subscribe frame for a sessionId, then prints Output frames. Optionally
// sends an Input line and watches for it to echo back from the box.
//
// Usage: node ws-probe.mjs <wsUrl> <sessionId> [inputLine]
import WebSocket from "ws";

const MAGIC = 0x5943;
const VERSION = 1;
const Type = { Welcome: 2, Subscribe: 10, Output: 20, Event: 22, Error: 23, Input: 30 };
const SubFlags = { Output: 1, Snapshot: 2, Events: 4 };

const enc = new TextEncoder();
const dec = new TextDecoder();

function encodeFrame(type, sessionId, payload) {
  const sid = enc.encode(sessionId ?? "");
  const pl = payload ?? new Uint8Array();
  const buf = new Uint8Array(2 + 1 + 1 + 4 + sid.length + 4 + pl.length);
  const view = new DataView(buf.buffer);
  let o = 0;
  view.setUint16(o, MAGIC, true); o += 2;
  view.setUint8(o, VERSION); o += 1;
  view.setUint8(o, type); o += 1;
  view.setUint32(o, sid.length, true); o += 4;
  buf.set(sid, o); o += sid.length;
  view.setUint32(o, pl.length, true); o += 4;
  buf.set(pl, o);
  return buf;
}

function decodeFrame(data) {
  const bytes = new Uint8Array(data);
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  if (view.getUint16(o, true) !== MAGIC) return null; o += 2;
  if (view.getUint8(o) !== VERSION) return null; o += 1;
  const type = view.getUint8(o); o += 1;
  const sidLen = view.getUint32(o, true); o += 4;
  const sessionId = dec.decode(bytes.subarray(o, o + sidLen)); o += sidLen;
  const plLen = view.getUint32(o, true); o += 4;
  return { type, sessionId, payload: bytes.subarray(o, o + plLen) };
}

function subscribePayload(flags) {
  const p = new Uint8Array(12);
  new DataView(p.buffer).setUint32(0, flags >>> 0, true);
  return p;
}

const wsUrl = process.argv[2] ?? "ws://localhost:8091/api/terminal/ws";
const sessionId = process.argv[3];
const inputLine = process.argv[4];
if (!sessionId) {
  console.error("usage: node ws-probe.mjs <wsUrl> <sessionId> [inputLine]");
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
let sawEcho = false;
const marker = inputLine ? inputLine.trim() : null;

ws.on("open", () => {
  console.log("[probe] open, subscribing to", sessionId);
  ws.send(encodeFrame(Type.Subscribe, sessionId, subscribePayload(SubFlags.Output | SubFlags.Events)));
});

ws.on("message", (data) => {
  const frame = decodeFrame(data);
  if (!frame) return;
  if (frame.type === Type.Welcome) {
    console.log("[probe] welcome:", dec.decode(frame.payload));
  } else if (frame.type === Type.Event) {
    console.log("[probe] event:", dec.decode(frame.payload));
    // once the bridge says it is ready, fire the input line
    if (inputLine && dec.decode(frame.payload).includes("ready")) {
      setTimeout(() => {
        console.log("[probe] sending input:", JSON.stringify(inputLine));
        ws.send(encodeFrame(Type.Input, sessionId, enc.encode(inputLine)));
      }, 500);
    }
  } else if (frame.type === Type.Error) {
    console.log("[probe] error:", dec.decode(frame.payload));
  } else if (frame.type === Type.Output) {
    const text = dec.decode(frame.payload);
    process.stdout.write(text);
    if (marker && text.includes(marker)) {
      sawEcho = true;
    }
  }
});

ws.on("close", () => {
  console.log("\n[probe] closed. echo seen:", sawEcho);
  process.exit(sawEcho || !marker ? 0 : 2);
});
ws.on("error", (e) => {
  console.error("[probe] ws error:", e.message);
});

// Give it time, then bail. If we saw the echo, exit success early.
const deadline = Number(process.env.PROBE_TIMEOUT_MS ?? 20000);
setTimeout(() => {
  console.log("\n[probe] timeout. echo seen:", sawEcho);
  ws.close();
}, deadline);

setInterval(() => {
  if (sawEcho) {
    console.log("\n[probe] echo confirmed, closing");
    ws.close();
  }
}, 500).unref();
