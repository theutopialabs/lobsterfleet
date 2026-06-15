import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createLease,
  coordinatorLeaseIdFromSessionLease,
  type BrokerEnv,
} from "../src/crabbox/broker.js";
import { releaseCrabboxLease, type RuntimeEnv } from "../src/core/index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("lobsterbox lease ids", () => {
  it("extracts lease ids from current and legacy session values", () => {
    assert.equal(coordinatorLeaseIdFromSessionLease("crabbox:lease-1"), "lease-1");
    assert.equal(coordinatorLeaseIdFromSessionLease("cbx_123"), "cbx_123");
    assert.equal(coordinatorLeaseIdFromSessionLease("lbx_123"), "lbx_123");
    assert.equal(coordinatorLeaseIdFromSessionLease("cloudflare:sandbox-1"), null);
    assert.equal(coordinatorLeaseIdFromSessionLease("clawfleet:box-1"), null);
    assert.equal(coordinatorLeaseIdFromSessionLease(null), null);
  });

  it("releases prefixed leases against /api/leases", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("{}");
    }) as typeof fetch;

    await releaseCrabboxLease(
      {
        LOBSTERBOX_URL: "http://broker.example.test:8090",
        LOBSTERBOX_TOKEN: "token",
      } as RuntimeEnv & BrokerEnv,
      "crabbox:lease-1",
    );

    assert.deepEqual(calls, ["http://broker.example.test:8090/api/leases/lease-1/release"]);
  });

  it("does not release non-lobsterbox leases", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("{}");
    }) as typeof fetch;

    await releaseCrabboxLease(
      {
        LOBSTERBOX_URL: "http://broker.example.test:8090",
        LOBSTERBOX_TOKEN: "token",
      } as RuntimeEnv & BrokerEnv,
      "cloudflare:sandbox-1",
    );

    assert.deepEqual(calls, []);
  });

  it("sends the bearer token and session owner header when creating a lease", async () => {
    let seenHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({ lease: { id: "cbx_1", state: "active", host: "h", port: 22 } }),
      );
    }) as typeof fetch;

    await createLease(
      {
        LOBSTERBOX_URL: "http://broker.example.test:8090",
        LOBSTERBOX_TOKEN: "token",
        LOBSTERBOX_SSH_PUBLIC_KEY: "ssh-ed25519 key",
      } as BrokerEnv,
      { owner: "session-owner" },
    );

    assert.equal(seenHeaders?.authorization, "Bearer token");
    assert.equal(seenHeaders?.["x-lobsterbox-owner"], "session-owner");
  });

  it("lets the configured owner override the session owner", async () => {
    let seenHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({ lease: { id: "cbx_1", state: "active", host: "h", port: 22 } }),
      );
    }) as typeof fetch;

    await createLease(
      {
        LOBSTERBOX_URL: "http://broker.example.test:8090",
        LOBSTERBOX_TOKEN: "token",
        LOBSTERBOX_OWNER: "fleet-owner",
        LOBSTERBOX_SSH_PUBLIC_KEY: "ssh-ed25519 key",
      } as BrokerEnv,
      { owner: "session-owner" },
    );

    assert.equal(seenHeaders?.["x-lobsterbox-owner"], "fleet-owner");
  });
});
