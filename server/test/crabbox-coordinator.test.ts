import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  crabboxCoordinatorLeaseHeaders,
  type RuntimeEnv,
} from "../src/core/index.js";

describe("crabbox coordinator", () => {
  it("omits the org header unless a coordinator org is configured", () => {
    const headers = crabboxCoordinatorLeaseHeaders(
      { CRABBOX_COORDINATOR_TOKEN: "broker-token" } as RuntimeEnv,
      { owner: "session-owner" },
    );

    assert.equal(headers.authorization, "Bearer broker-token");
    assert.equal(headers["x-crabbox-owner"], "session-owner");
    assert.equal(headers["x-crabbox-org"], undefined);
  });

  it("uses configured owner and org tags for broker lease grouping", () => {
    const headers = crabboxCoordinatorLeaseHeaders(
      {
        CRABBOX_COORDINATOR_TOKEN: "broker-token",
        CRABBOX_COORDINATOR_ORG: "acme",
        CRABBOX_OWNER: "fleet-owner",
      } as RuntimeEnv,
      { owner: "session-owner" },
    );

    assert.equal(headers["x-crabbox-owner"], "fleet-owner");
    assert.equal(headers["x-crabbox-org"], "acme");
  });
});
