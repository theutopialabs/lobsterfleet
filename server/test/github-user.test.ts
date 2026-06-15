import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { refreshGitHubUser, type RuntimeEnv } from "../src/core/index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GitHub user refresh", () => {
  it("does not require org membership when GITHUB_ORG is unset", async () => {
    const seen = mockGitHub({
      "/user": { id: 42, login: "octo", email: null, name: "Octo Cat" },
      "/user/emails": [{ email: "octo@example.test", primary: true, verified: true }],
      "/user/teams": [
        { slug: "platform", organization: { login: "acme" } },
        { slug: "ops", organization: { login: "other" } },
      ],
    });

    const user = await refreshGitHubUser({} as RuntimeEnv, "gh-token");

    assert.equal(user?.subject, "github:42");
    assert.equal(user?.email, "octo@example.test");
    assert.deepEqual(user?.teams, ["@acme/platform", "@other/ops"]);
    assert.ok(!seen.some((path) => path.startsWith("/user/memberships/orgs/")));
  });

  it("requires active membership when GITHUB_ORG is set", async () => {
    mockGitHub({
      "/user": { id: 42, login: "octo", email: "octo@example.test", name: "Octo Cat" },
      "/user/emails": [],
      "/user/memberships/orgs/acme": { state: "active" },
      "/user/teams": [
        { slug: "platform", organization: { login: "acme" } },
        { slug: "ops", organization: { login: "other" } },
      ],
    });

    const user = await refreshGitHubUser({ GITHUB_ORG: "acme" } as RuntimeEnv, "gh-token");

    assert.equal(user?.subject, "github:42");
    assert.deepEqual(user?.teams, ["@acme/platform"]);
  });

  it("rejects users outside the configured org", async () => {
    mockGitHub({
      "/user": { id: 42, login: "octo", email: "octo@example.test", name: "Octo Cat" },
      "/user/emails": [],
      "/user/memberships/orgs/acme": null,
      "/user/teams": [],
    });

    const user = await refreshGitHubUser({ GITHUB_ORG: "acme" } as RuntimeEnv, "gh-token");

    assert.equal(user, null);
  });
});

function mockGitHub(routes: Record<string, unknown>): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname;
    seen.push(path);
    const value = routes[path];
    if (value === undefined || value === null) {
      return jsonResponse({ error: "not found" }, 404);
    }
    return jsonResponse(value, 200);
  }) as typeof fetch;
  return seen;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
