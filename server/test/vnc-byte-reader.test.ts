import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byteReader } from "../src/crabbox/vncBridge.js";

describe("vnc byte reader", () => {
  it("queues concurrent reads in order", async () => {
    const reader = byteReader();
    const first = reader.read(2);
    const second = reader.read(3);

    reader.feed(Buffer.from("abcde"));

    assert.equal((await first).toString("utf8"), "ab");
    assert.equal((await second).toString("utf8"), "cde");
  });

  it("keeps leftover bytes after queued reads", async () => {
    const reader = byteReader();
    const first = reader.read(2);

    reader.feed(Buffer.from("abcd"));

    assert.equal((await first).toString("utf8"), "ab");
    assert.equal(reader.leftover().toString("utf8"), "cd");
  });
});
