import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trustForwardedHeaders, isPrivateAddress } from "../src/proxyTrust.js";

describe("forwarded header trust", () => {
  it("trusts loopback peers by default", () => {
    assert.equal(trustForwardedHeaders("127.0.0.1", undefined), true);
    assert.equal(trustForwardedHeaders("::1", undefined), true);
    assert.equal(trustForwardedHeaders("::ffff:127.0.0.1", undefined), true);
  });

  it("trusts private-range peers by default", () => {
    assert.equal(trustForwardedHeaders("10.0.0.5", undefined), true);
    assert.equal(trustForwardedHeaders("192.168.1.20", undefined), true);
    assert.equal(trustForwardedHeaders("172.16.0.3", undefined), true);
    assert.equal(trustForwardedHeaders("::ffff:10.1.2.3", undefined), true);
  });

  it("does not trust public peers by default", () => {
    assert.equal(trustForwardedHeaders("203.0.113.7", undefined), false);
    assert.equal(trustForwardedHeaders("8.8.8.8", undefined), false);
    assert.equal(trustForwardedHeaders(undefined, undefined), false);
  });

  it("honors the always and never overrides", () => {
    assert.equal(trustForwardedHeaders("203.0.113.7", "always"), true);
    assert.equal(trustForwardedHeaders("127.0.0.1", "never"), false);
  });

  it("does not treat 172.32.x as private", () => {
    assert.equal(isPrivateAddress("172.32.0.1"), false);
    assert.equal(isPrivateAddress("172.15.0.1"), false);
  });
});
