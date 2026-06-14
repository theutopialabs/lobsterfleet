import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { createLocalBucket } from "../src/localBucket.js";

describe("local archive bucket", () => {
  it("stores and reads objects under the archive root", async () => {
    const root = await mkdtemp(join(tmpdir(), "lobsterfleet-bucket-"));
    try {
      const bucket = createLocalBucket(root);

      await bucket.put("sessions/one/transcript.txt", "hello");
      const object = await bucket.get("sessions/one/transcript.txt");

      assert.ok(object);
      assert.equal(await new Response(object.body).text(), "hello");
      assert.equal(await readFile(join(root, "sessions/one/transcript.txt"), "utf8"), "hello");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks archive keys that escape the archive root", async () => {
    const root = await mkdtemp(join(tmpdir(), "lobsterfleet-bucket-"));
    try {
      const bucket = createLocalBucket(root);

      await assert.rejects(() => bucket.put("../escape.txt", "bad"), /archive key escapes/);
      assert.equal(await bucket.get("../escape.txt"), null);
      await assert.doesNotReject(() => bucket.delete("../escape.txt"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
