import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  terminalAttentionFingerprint,
  terminalAttentionReason,
  terminalInputClearsAttention,
} from "../src/core/attention.js";

const enc = new TextEncoder();

describe("terminal attention detection", () => {
  it("detects the Codex trust prompt", () => {
    assert.equal(
      terminalAttentionReason("Do you trust the contents of this directory?\nPress enter to continue"),
      "Trust confirmation needed",
    );
  });

  it("detects confirmation prompts with ansi output", () => {
    assert.equal(
      terminalAttentionReason("\x1b[33mApproval required\x1b[0m\nDo you want to continue?"),
      "Waiting for confirmation",
    );
  });

  it("detects menu choices", () => {
    assert.equal(
      terminalAttentionReason("_ 1. Yes, continue\n  2. No, quit"),
      "Waiting for a menu choice",
    );
  });

  it("detects the Codex prompt screen", () => {
    assert.equal(
      terminalAttentionReason(
        "model: gpt-5.5 xhigh /model to change\n" +
          "directory: ~/work/hello-world\n\n" +
          "\u203A Ask me a question\n\n" +
          "\u2022 What are you working on today?\n\n" +
          "\u203A Implement {feature}\n\n" +
          "gpt-5.5 xhigh - Context 0% used",
      ),
      "Waiting for prompt",
    );
  });

  it("ignores ordinary terminal output", () => {
    assert.equal(terminalAttentionReason("tests passed\nready"), null);
  });

  it("fingerprints equivalent ansi output the same way", () => {
    assert.equal(
      terminalAttentionFingerprint("\x1b[31mPress enter to continue\x1b[0m"),
      terminalAttentionFingerprint("Press enter to continue"),
    );
  });

  it("does not clear attention for terminal focus escape sequences", () => {
    assert.equal(terminalInputClearsAttention(enc.encode("\x1b[I")), false);
    assert.equal(terminalInputClearsAttention(enc.encode("\x1b[O")), false);
  });

  it("clears attention for typed text or enter", () => {
    assert.equal(terminalInputClearsAttention(enc.encode("yes")), true);
    assert.equal(terminalInputClearsAttention(enc.encode("\r")), true);
  });
});
