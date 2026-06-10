import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleRequest, isAllowedBrowserOrigin } from "../src/core/index.js";
import type { RuntimeEnv } from "../src/core/index.js";

describe("browser origin boundary", () => {
  it("allows requests without a browser Origin header", () => {
    const request = new Request("http://localhost:8099/api/logout", { method: "POST" });
    assert.equal(isAllowedBrowserOrigin(request), true);
  });

  it("allows same-origin browser requests", () => {
    const request = new Request("http://localhost:8099/api/logout", {
      method: "POST",
      headers: { Origin: "http://localhost:8099" },
    });
    assert.equal(isAllowedBrowserOrigin(request), true);
  });

  it("rejects cross-origin browser requests", async () => {
    const response = await handleRequest(
      new Request("http://localhost:8099/api/login/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: "https://evil.test",
        },
        body: JSON.stringify({ token: "dev" }),
      }),
      {} as RuntimeEnv,
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "cross-origin request blocked" });
  });
});

describe("direct app routes", () => {
  for (const path of ["/", "/board", "/sessions", "/admin", "/settings"]) {
    it(`serves the SPA for ${path}`, async () => {
      const response = await handleRequest(
        new Request(`http://localhost:8099${path}`, { method: "GET" }),
        {} as RuntimeEnv,
      );

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.match(await response.text(), /<title>lobsterfleet<\/title>/);
    });
  }
});

describe("public app origin", () => {
  it("redirects legacy hosts to the configured public URL", async () => {
    const response = await handleRequest(
      new Request("https://lobsterfleet-ai.services-91b.workers.dev/sessions?view=live", {
        method: "GET",
      }),
      {
        LOBSTERFLEET_PUBLIC_URL: "https://fleet.example.test/base",
        LOBSTERFLEET_REDIRECT_HOSTS: "lobsterfleet-ai.services-91b.workers.dev",
      } as RuntimeEnv,
    );

    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "https://fleet.example.test/sessions?view=live");
  });

  it("does not redirect legacy hosts by default", async () => {
    const response = await handleRequest(
      new Request("https://lobsterfleet-ai.services-91b.workers.dev/sessions", {
        method: "GET",
      }),
      { LOBSTERFLEET_PUBLIC_URL: "https://fleet.example.test" } as RuntimeEnv,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
  });
});

describe("local dev identity boundary", () => {
  it("shows local dev identity for loopback non-production installs", async () => {
    const response = await handleRequest(
      new Request("http://localhost:8099/api/auth", {
        headers: { "x-lobsterfleet-local-request": "1" },
      }),
      {} as RuntimeEnv,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      auth: { github: false, token: false, devIdentity: true },
    });
  });

  it("hides local dev identity when the public URL is not local", async () => {
    const response = await handleRequest(
      new Request("http://localhost:8099/api/auth", {
        headers: { "x-lobsterfleet-local-request": "1" },
      }),
      { LOBSTERFLEET_PUBLIC_URL: "https://fleet.example.test" } as RuntimeEnv,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      auth: { github: false, token: false, devIdentity: false },
    });
  });

  it("hides local dev identity in production unless explicitly enabled", async () => {
    const disabled = await handleRequest(
      new Request("http://localhost:8099/api/auth", {
        headers: { "x-lobsterfleet-local-request": "1" },
      }),
      { NODE_ENV: "production" } as RuntimeEnv,
    );
    assert.equal(disabled.status, 200);
    assert.deepEqual(await disabled.json(), {
      auth: { github: false, token: false, devIdentity: false },
    });

    const enabled = await handleRequest(
      new Request("http://localhost:8099/api/auth", {
        headers: { "x-lobsterfleet-local-request": "1" },
      }),
      { NODE_ENV: "production", LOBSTERFLEET_ENABLE_DEV_IDENTITY: "1" } as RuntimeEnv,
    );
    assert.equal(enabled.status, 200);
    assert.deepEqual(await enabled.json(), {
      auth: { github: false, token: false, devIdentity: true },
    });
  });

  it("does not allow dev login when public URL is not local", async () => {
    const response = await handleRequest(
      new Request("http://localhost:8099/api/login/dev", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lobsterfleet-local-request": "1",
          Origin: "http://localhost:8099",
        },
        body: JSON.stringify({ id: "owner", name: "Owner", role: "owner" }),
      }),
      { LOBSTERFLEET_PUBLIC_URL: "https://fleet.example.test" } as RuntimeEnv,
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not found" });
  });
});
