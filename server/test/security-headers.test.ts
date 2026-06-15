import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleRequest, type RuntimeEnv } from "../src/core/index.js";
import { appContentSecurityPolicy, responseSecurityHeaders } from "../src/securityHeaders.js";

describe("security headers", () => {
  it("sets a restrictive base policy", () => {
    const headers = responseSecurityHeaders("text/html; charset=utf-8", "no-store");

    assert.equal(headers["content-security-policy"], appContentSecurityPolicy);
    assert.match(headers["content-security-policy"], /script-src 'self'/);
    assert.match(headers["content-security-policy"], /connect-src 'self'/);
    assert.doesNotMatch(headers["content-security-policy"] ?? "", /connect-src[^;]*\bws:/);
    assert.doesNotMatch(headers["content-security-policy"] ?? "", /connect-src[^;]*\bwss:/);
    assert.match(headers["content-security-policy"], /object-src 'none'/);
    assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(headers["x-frame-options"], "DENY");
    assert.equal(headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
    assert.equal(headers["x-content-type-options"], "nosniff");
    assert.equal(headers["referrer-policy"], "no-referrer");
    assert.match(headers["permissions-policy"] ?? "", /camera=\(\)/);
  });

  it("applies security headers to core json responses", async () => {
    const response = await handleRequest(
      new Request("http://localhost:8099/api/auth", { method: "GET" }),
      {} as RuntimeEnv,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-security-policy"), appContentSecurityPolicy);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(
      response.headers.get("strict-transport-security"),
      "max-age=31536000; includeSubDomains",
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("applies security headers to auth redirects", async () => {
    const response = await handleRequest(
      new Request("http://localhost:8099/login/github", { method: "GET" }),
      {
        GITHUB_CLIENT_ID: "client-id",
        GITHUB_CLIENT_SECRET: "client-secret",
      } as RuntimeEnv,
    );

    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /^https:\/\/github\.com\//);
    assert.match(response.headers.get("set-cookie") ?? "", /^crabbox_oauth_state=/);
    assert.equal(response.headers.get("content-security-policy"), appContentSecurityPolicy);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});
