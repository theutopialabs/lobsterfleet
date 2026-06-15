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

  it("rejects pending reads when canceled", async () => {
    const reader = byteReader();
    const pending = reader.read(4);

    reader.cancel(new Error("closed"));

    await assert.rejects(pending, /closed/);
    await assert.rejects(() => reader.read(1), /closed/);
  });

  it("cancels instead of buffering without bound", async () => {
    const reader = byteReader();
    // Ask for one huge read that the dribble below will never satisfy.
    const pending = reader.read(64 * 1024 * 1024);

    // Feed 9MB in chunks. Past the 8MB cap the reader should bail out instead
    // of growing the buffer forever.
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 9; i++) reader.feed(chunk);

    await assert.rejects(pending, /overflow/);
    await assert.rejects(() => reader.read(1), /overflow/);
  });
});
