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

describe("crabbox lease ids", () => {
  it("extracts coordinator lease ids from current and legacy session values", () => {
    assert.equal(coordinatorLeaseIdFromSessionLease("crabbox:lease-1"), "lease-1");
    assert.equal(coordinatorLeaseIdFromSessionLease("cbx_123"), "cbx_123");
    assert.equal(coordinatorLeaseIdFromSessionLease("cloudflare:sandbox-1"), null);
    assert.equal(coordinatorLeaseIdFromSessionLease("clawfleet:box-1"), null);
    assert.equal(coordinatorLeaseIdFromSessionLease(null), null);
  });

  it("releases prefixed coordinator leases without requiring a cbx prefix", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("{}");
    }) as typeof fetch;

    await releaseCrabboxLease(
      {
        CRABBOX_COORDINATOR_URL: "https://broker.example.test",
        CRABBOX_COORDINATOR_TOKEN: "token",
      } as RuntimeEnv & BrokerEnv,
      "crabbox:lease-1",
    );

    assert.deepEqual(calls, ["https://broker.example.test/v1/leases/lease-1/release"]);
  });

  it("does not release non-coordinator leases", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("{}");
    }) as typeof fetch;

    await releaseCrabboxLease(
      {
        CRABBOX_COORDINATOR_URL: "https://broker.example.test",
        CRABBOX_COORDINATOR_TOKEN: "token",
      } as RuntimeEnv & BrokerEnv,
      "cloudflare:sandbox-1",
    );

    assert.deepEqual(calls, []);
  });

  it("sends org and session owner headers when creating a lease", async () => {
    let seenHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ lease: { id: "cbx_1", state: "provisioning" } }));
    }) as typeof fetch;

    await createLease(
      {
        CRABBOX_COORDINATOR_URL: "https://broker.example.test",
        CRABBOX_COORDINATOR_TOKEN: "token",
        CRABBOX_COORDINATOR_ORG: "acme",
        CRABBOX_COORDINATOR_SSH_PUBLIC_KEY: "ssh-ed25519 key",
      } as BrokerEnv,
      { owner: "session-owner" },
    );

    assert.equal(seenHeaders?.authorization, "Bearer token");
    assert.equal(seenHeaders?.["x-crabbox-owner"], "session-owner");
    assert.equal(seenHeaders?.["x-crabbox-org"], "acme");
  });

  it("lets configured owner override the session owner", async () => {
    let seenHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ lease: { id: "cbx_1", state: "provisioning" } }));
    }) as typeof fetch;

    await createLease(
      {
        CRABBOX_COORDINATOR_URL: "https://broker.example.test",
        CRABBOX_COORDINATOR_TOKEN: "token",
        CRABBOX_OWNER: "fleet-owner",
        CRABBOX_COORDINATOR_SSH_PUBLIC_KEY: "ssh-ed25519 key",
      } as BrokerEnv,
      { owner: "session-owner" },
    );

    assert.equal(seenHeaders?.["x-crabbox-owner"], "fleet-owner");
  });
});
