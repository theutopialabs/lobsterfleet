import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveRuntimePath } from "../src/runtimePaths.js";

describe("runtime path resolution", () => {
  it("resolves relative paths from the app root", () => {
    assert.equal(
      resolveRuntimePath("./server/.secrets/crabbox_id_ed25519", "/repo/lobsterfleet"),
      join("/repo/lobsterfleet", "server/.secrets/crabbox_id_ed25519"),
    );
  });

  it("keeps absolute paths unchanged", () => {
    assert.equal(resolveRuntimePath("/var/lib/lobsterfleet/db.sqlite", "/repo"), "/var/lib/lobsterfleet/db.sqlite");
  });
});
