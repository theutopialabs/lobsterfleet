import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import type { WebSocket } from "ws";
import { vncChallengeResponse } from "./vncAuth.js";
import type { SshTarget } from "./sshBridge.js";

// Bridges a browser noVNC client to a leased crabbox's desktop.
// The box runs x11vnc on 127.0.0.1:5900 (localhost only) behind a VNC password.
// We SSH in (same key the terminal uses), forward to that port, answer the VNC
// auth challenge server-side with the box's password, and present the browser a
// no-auth RFB stream. After both handshakes we just splice the raw bytes.

export type VncBridgeOpts = {
  knownHostKey?: string | null;
  onLearnHostKey?: (hostKeyHash: string) => void;
  onReady?: () => void;
  onClose?: () => void;
  onError?: (message: string) => void;
};

const RFB_VERSION = Buffer.from("RFB 003.008\n", "latin1");
// Where the desktop bootstrap writes the plaintext VNC password. The Linux
// (Hetzner) image uses /var/lib; some images use /var/db, so we try both.
const VNC_PASSWORD_PATHS = ["/var/lib/crabbox/vnc.password", "/var/db/crabbox/vnc.password"];
const BOX_VNC_PORT = 5900;

function hostKeyMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function toBuf(data: Buffer | ArrayBuffer | Buffer[]): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return null;
}

// A tiny async byte reader fed by stream/socket events. read(n) resolves once n
// bytes are buffered; leftover() drains whatever is left after the handshake.
type ByteReader = {
  feed: (b: Buffer) => void;
  read: (n: number) => Promise<Buffer>;
  leftover: () => Buffer;
};

function byteReader(): ByteReader {
  let buf = Buffer.alloc(0);
  let want: { n: number; resolve: (b: Buffer) => void } | null = null;
  const pump = (): void => {
    if (want && buf.length >= want.n) {
      const out = buf.subarray(0, want.n);
      buf = buf.subarray(want.n);
      const resolve = want.resolve;
      want = null;
      resolve(out);
    }
  };
  return {
    feed(b) {
      buf = Buffer.concat([buf, b]);
      pump();
    },
    read(n) {
      return new Promise((resolve) => {
        want = { n, resolve };
        pump();
      });
    },
    leftover() {
      const b = buf;
      buf = Buffer.alloc(0);
      return b;
    },
  };
}

// Reads the box's VNC password over ssh (best effort). The file is mode 0600
// owned by crabbox, and we ssh in as crabbox, so the cat succeeds.
function readVncPassword(conn: Client): Promise<string> {
  // Try each path in order, first non-empty wins. 2>/dev/null hides misses.
  const cmd = VNC_PASSWORD_PATHS.map((p) => `cat ${p} 2>/dev/null`).join(" || ");
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("no exec stream"));
        return;
      }
      let out = "";
      stream.on("data", (chunk: Buffer) => {
        out += chunk.toString("utf8");
      });
      stream.stderr.on("data", () => {});
      stream.on("close", () => resolve(out.trim()));
    });
  });
}

// Wires one raw (binary RFB) ws to one box desktop. Returns a teardown fn.
export function attachVncBridge(
  ws: WebSocket,
  target: SshTarget,
  opts: VncBridgeOpts = {},
): () => void {
  const conn = new Client();
  let closed = false;
  let hostKeyOk = true;
  let boxStream: import("ssh2").ClientChannel | null = null;
  // handshake -> we buffer into readers. pipe -> we splice raw bytes.
  let phase: "handshake" | "pipe" = "handshake";
  const wsReader = byteReader();
  const boxReader = byteReader();

  const fail = (message: string): void => {
    if (!closed) opts.onError?.(message);
    teardown();
  };

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    opts.onClose?.();
    try {
      boxStream?.end();
    } catch {
      // gone
    }
    try {
      conn.end();
    } catch {
      // gone
    }
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      try {
        ws.close();
      } catch {
        // closing
      }
    }
  };

  const wsSend = (buf: Buffer): void => {
    if (ws.readyState === ws.OPEN) ws.send(buf);
  };

  let privateKey: Buffer;
  try {
    privateKey = readFileSync(target.privateKeyPath);
  } catch (error) {
    fail(`cannot read ssh key: ${String(error)}`);
    return teardown;
  }

  // ws -> box. During handshake feed the reader; after, splice straight through.
  ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = toBuf(data);
    if (!buf) return;
    if (phase === "pipe") boxStream?.write(buf);
    else wsReader.feed(buf);
  });
  ws.on("close", () => teardown());
  ws.on("error", () => teardown());

  conn.on("ready", () => {
    void (async () => {
      let password: string;
      try {
        password = await readVncPassword(conn);
      } catch (error) {
        fail(`could not read vnc password: ${String(error)}`);
        return;
      }
      if (!password) {
        fail("vnc password empty; is this a GUI (desktop) lease?");
        return;
      }
      conn.forwardOut("127.0.0.1", 0, "127.0.0.1", BOX_VNC_PORT, (err, stream) => {
        if (err || !stream) {
          fail(`vnc port forward failed: ${err ? err.message : "no stream"}`);
          return;
        }
        boxStream = stream;
        stream.on("data", (chunk: Buffer) => {
          if (phase === "pipe") wsSend(chunk);
          else boxReader.feed(chunk);
        });
        stream.on("close", () => teardown());
        stream.on("error", () => teardown());
        void runHandshake(password).catch((error) => fail(`vnc handshake failed: ${String(error)}`));
      });
    })();
  });

  conn.on("error", (err) => {
    if (hostKeyOk) fail(`ssh error: ${err.message}`);
    else teardown();
  });
  conn.on("close", () => teardown());

  // The actual relay. Authenticate to the box, then offer the browser None auth.
  async function runHandshake(password: string): Promise<void> {
    if (!boxStream) return;
    // ---- box side: act as a VNC client to x11vnc ----
    await boxReader.read(12); // server ProtocolVersion ("RFB 003.008\n")
    boxStream.write(RFB_VERSION);
    const count = (await boxReader.read(1))[0]!;
    if (count === 0) {
      // failure: 4-byte reason length + reason
      const len = (await boxReader.read(4)).readUInt32BE(0);
      const reason = (await boxReader.read(len)).toString("utf8");
      throw new Error(`box refused security: ${reason}`);
    }
    const types = await boxReader.read(count);
    if (!types.includes(2)) throw new Error("box did not offer VNC auth");
    boxStream.write(Buffer.from([2])); // pick VNC auth
    const challenge = await boxReader.read(16);
    boxStream.write(vncChallengeResponse(password, challenge));
    const result = (await boxReader.read(4)).readUInt32BE(0);
    if (result !== 0) throw new Error("box VNC auth rejected our password");

    // ---- browser side: act as a VNC server offering None ----
    wsSend(RFB_VERSION);
    await wsReader.read(12); // client ProtocolVersion
    wsSend(Buffer.from([1, 1])); // one security type: None (1)
    await wsReader.read(1); // client picks it
    wsSend(Buffer.from([0, 0, 0, 0])); // SecurityResult OK (RFB 3.8)

    // Both sides authed. Flush anything already buffered, then go transparent.
    phase = "pipe";
    const fromWs = wsReader.leftover();
    if (fromWs.length) boxStream.write(fromWs);
    const fromBox = boxReader.leftover();
    if (fromBox.length) wsSend(fromBox);
    opts.onReady?.();
  }

  conn.connect({
    host: target.host,
    port: target.port,
    username: target.user,
    privateKey,
    readyTimeout: 30_000,
    keepaliveInterval: 15_000,
    hostHash: "sha256",
    hostVerifier: (data: Buffer | string): boolean => {
      const hashedKey = typeof data === "string" ? data : data.toString("hex");
      const known = opts.knownHostKey ?? null;
      if (!known) {
        opts.onLearnHostKey?.(hashedKey);
        return true;
      }
      if (hostKeyMatches(known, hashedKey)) return true;
      hostKeyOk = false;
      fail("ssh host key changed, refusing to connect");
      return false;
    },
  });

  return teardown;
}
