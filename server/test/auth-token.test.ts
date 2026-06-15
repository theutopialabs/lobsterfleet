import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { constantTimeEqual } from "../src/core/index.js";

describe("auth token comparison", () => {
  it("matches equal token strings", () => {
    assert.equal(constantTimeEqual("Bearer secret", "Bearer secret"), true);
  });

  it("rejects same-prefix token strings", () => {
    assert.equal(constantTimeEqual("Bearer secret", "Bearer secret-extra"), false);
  });

  it("rejects same-length token strings with different content", () => {
    assert.equal(constantTimeEqual("Bearer secret", "Bearer secres"), false);
  });

  it("rejects empty values", () => {
    assert.equal(constantTimeEqual("", "Bearer secret"), false);
  });
});
