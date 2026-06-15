import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createLease, getLease, type BrokerEnv } from "../src/crabbox/broker.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Captures the request lobsterbox sees: url, headers, parsed JSON body.
function capture(leaseOverrides: Record<string, unknown> = {}): {
  url: () => string;
  headers: () => Record<string, string>;
  body: () => Record<string, unknown>;
} {
  let url = "";
  let headers: Record<string, string> = {};
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    headers = (init?.headers ?? {}) as Record<string, string>;
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        lease: {
          id: "cbx_1",
          state: "active",
          host: "127.0.0.1",
          port: 32811,
          sshUser: "runner",
          ...leaseOverrides,
        },
      }),
    );
  }) as typeof fetch;
  return { url: () => url, headers: () => headers, body: () => body };
}

const baseEnv = {
  LOBSTERBOX_URL: "http://broker.test:8090",
  LOBSTERBOX_TOKEN: "tok",
  LOBSTERBOX_SSH_PUBLIC_KEY: "ssh-ed25519 AAAA runner",
} as BrokerEnv;

describe("lobsterbox createLease", () => {
  it("POSTs /api/leases with the bearer token and owner header", async () => {
    const cap = capture();
    await createLease({ ...baseEnv, LOBSTERBOX_OWNER: "vishnu" }, {});
    assert.match(cap.url(), /\/api\/leases$/);
    assert.equal(cap.headers().authorization, "Bearer tok");
    assert.equal(cap.headers()["x-lobsterbox-owner"], "vishnu");
  });

  it("sends publicKey, region, machine, and a generated id", async () => {
    const cap = capture();
    await createLease(
      { ...baseEnv, LOBSTERBOX_REGION: "fsn1", LOBSTERBOX_MACHINE: "cpx22" },
      { requestedSlug: "box-1" },
    );
    const body = cap.body();
    assert.equal(body.publicKey, "ssh-ed25519 AAAA runner");
    assert.equal(body.region, "fsn1");
    assert.equal(body.machine, "cpx22");
    assert.equal(body.slug, "box-1");
    assert.match(String(body.id), /^cbx_[0-9a-f]+$/);
  });

  it("defaults to the local docker catalog when nothing is configured", async () => {
    const cap = capture();
    await createLease(baseEnv, {});
    assert.equal(cap.body().region, "local");
    assert.equal(cap.body().machine, "docker");
  });

  it("maps legacy location/serverType opts onto region/machine", async () => {
    const cap = capture();
    await createLease(baseEnv, { location: "hel1", serverType: "cx22" });
    assert.equal(cap.body().region, "hel1");
    assert.equal(cap.body().machine, "cx22");
  });

  it("sends the requested size class and apt upgrade flag", async () => {
    const cap = capture();
    await createLease(baseEnv, { class: "fast", aptUpgrade: true });
    assert.equal(cap.body().class, "fast");
    assert.equal(cap.body().aptUpgrade, true);
  });

  it("mirrors the numeric port onto sshPort so the ssh bridge can read it", async () => {
    capture();
    const lease = await createLease(baseEnv, {});
    assert.equal(lease.sshPort, 32811);
    assert.equal(lease.host, "127.0.0.1");
    assert.equal(lease.sshUser, "runner");
    assert.equal(lease.state, "active");
  });

  it("preserves the desktop flag from lobsterbox", async () => {
    capture({ desktop: true });
    const lease = await createLease(baseEnv, {});
    assert.equal(lease.desktop, true);
  });

  it("throws LOBSTERBOX_SSH_PUBLIC_KEY when no key is configured", async () => {
    await assert.rejects(
      createLease({ LOBSTERBOX_URL: "http://b", LOBSTERBOX_TOKEN: "t" } as BrokerEnv, {}),
      /LOBSTERBOX_SSH_PUBLIC_KEY/,
    );
  });

  it("maps an aborted (timed out) fetch to a clear timeout error", async () => {
    globalThis.fetch = (async () => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    }) as typeof fetch;
    await assert.rejects(createLease(baseEnv, {}), /timed out/);
  });

  // Creating a lease boots a real cloud VM and waits for ssh, which takes longer
  // than the 30s default. Booting Hetzner used to time out at 30s and orphan the
  // box, so createLease gets a much longer window than quick calls like getLease.
  it("gives lease creation a longer timeout than quick calls", async () => {
    const timeoutError = () => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    };
    globalThis.fetch = (async () => timeoutError()) as typeof fetch;

    let leaseMsg = "";
    await createLease(baseEnv, {}).catch((e: Error) => (leaseMsg = e.message));
    let getMsg = "";
    await getLease(baseEnv, "cbx_1").catch((e: Error) => (getMsg = e.message));

    const leaseMs = Number(leaseMsg.match(/after (\d+)ms/)?.[1] ?? 0);
    const getMs = Number(getMsg.match(/after (\d+)ms/)?.[1] ?? 0);
    assert.ok(leaseMs > getMs, `lease timeout ${leaseMs}ms should exceed quick-call ${getMs}ms`);
  });

  it("surfaces lobsterbox's clean JSON error", async () => {
    globalThis.fetch = (async () =>
      new Response('{"error":"unknown machine for local: ccx33"}', { status: 400 })) as typeof fetch;
    await assert.rejects(createLease(baseEnv, {}), (error: Error) => {
      assert.match(error.message, /unknown machine for local: ccx33/);
      return true;
    });
  });
});
