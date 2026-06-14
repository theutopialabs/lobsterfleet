// Covers the crabbox bootstrap: stdin part framing, and the actual script run
// locally against a temp HOME (codex files placed, repo cloned, prompt
// written, markers emitted). tmux is never started (command part left empty).

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import {
  BOOTSTRAP_SCRIPT,
  buildBootstrapStdin,
  codexFileForWorkspace,
  repoDirName,
  workspaceNotes,
} from "../src/crabbox/codexBootstrap.js";

describe("bootstrap stdin framing", () => {
  it("length-prefixes parts in order, byte counts not char counts", () => {
    const payload = buildBootstrapStdin({
      authJson: "{}",
      configToml: "ä", // 2 bytes in utf8
      agentsMd: null,
      gitCredential: "",
      repoUrl: "https://github.com/a/b.git",
      branch: "main",
      dir: "b",
      command: "codex --yolo",
      prompt: "fix the bug\nplease",
    });
    assert.equal(
      payload,
      "2\n{}" +
        "2\nä" +
        "0\n" +
        "0\n" +
        "26\nhttps://github.com/a/b.git" +
        "4\nmain" +
        "1\nb" +
        "12\ncodex --yolo" +
        "18\nfix the bug\nplease",
    );
  });
});

describe("codex file selection", () => {
  it("prefers per-crabbox text, then project defaults, then host files", () => {
    assert.equal(codexFileForWorkspace("# host\n", "# project\n", "# box\n"), "# box\n");
    assert.equal(codexFileForWorkspace("# host\n", "# project\n", ""), "");
    assert.equal(codexFileForWorkspace("# host\n", "# project\n"), "# project\n");
    assert.equal(codexFileForWorkspace("# host\n", null), "# host\n");
  });
});

describe("repo dir name", () => {
  it("uses the repo half and scrubs weird characters", () => {
    assert.equal(repoDirName("acme/my-app"), "my-app");
    assert.equal(repoDirName("acme/we ird$name"), "we-ird-name");
    assert.equal(repoDirName(""), "repo");
  });
});

describe("workspace notes", () => {
  it("summarizes the script markers", () => {
    assert.equal(
      workspaceNotes("CLONE_OK\nTMUX_OK\ncodex-cli 1.0"),
      " · repo cloned · codex started in tmux",
    );
    assert.equal(workspaceNotes("CLONE_FAIL"), " · repo clone failed");
    assert.equal(workspaceNotes("codex-cli 1.0"), "");
  });
});

describe("bootstrap script (run locally)", () => {
  it("places codex files, clones the repo, writes the prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "lobsterfleet-bootstrap-"));
    try {
      // a local source repo standing in for github
      const source = join(root, "source");
      git(root, "init", "-b", "main", source);
      await writeFile(join(source, "README.md"), "hello\n");
      git(source, "add", ".");
      git(source, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");

      const home = join(root, "home");
      const stdin = buildBootstrapStdin({
        authJson: '{"token":"secret"}',
        configToml: "model = \"gpt-5\"\n",
        agentsMd: "# rules\n",
        gitCredential: "https://x-access-token:tok@github.com",
        repoUrl: source,
        branch: "feature-x", // does not exist upstream -> checkout -B path
        dir: "myrepo",
        command: "", // never start tmux from a test
        prompt: "do the thing",
      });

      // run the same command string sshd would, with HOME sandboxed
      const result = spawnSync("sh", ["-c", BOOTSTRAP_SCRIPT], {
        input: stdin,
        env: { ...process.env, HOME: home },
        encoding: "utf8",
        timeout: 60_000,
      });
      const output = `${result.stdout}\n${result.stderr}`;

      assert.equal(await readFile(join(home, ".codex/auth.json"), "utf8"), '{"token":"secret"}');
      const config = await readFile(join(home, ".codex/config.toml"), "utf8");
      assert.ok(config.startsWith('model = "gpt-5"\n'));
      assert.match(config, new RegExp(`\\[projects\\."${escapeRegExp(join(home, "work/myrepo"))}"\\]`));
      assert.match(config, /trust_level = "trusted"/);
      assert.equal(await readFile(join(home, ".codex/AGENTS.md"), "utf8"), "# rules\n");
      assert.equal(
        await readFile(join(home, ".git-credentials"), "utf8"),
        "https://x-access-token:tok@github.com\n",
      );
      assert.match(output, /CLONE_NEW_BRANCH/);
      assert.equal(
        await readFile(join(home, "work/myrepo/README.md"), "utf8"),
        "hello\n",
      );
      assert.equal(
        await readFile(join(home, "work/myrepo/.crabbox-prompt.md"), "utf8"),
        "do the thing\n",
      );
      const branch = git(join(home, "work/myrepo"), "branch", "--show-current");
      assert.equal(branch.trim(), "feature-x");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps secrets off the command line", () => {
    // the script must be fully static: secrets only travel over stdin
    assert.doesNotMatch(BOOTSTRAP_SCRIPT, /x-access-token|secret|ghp_/);
  });

  it("has no single quotes inside the bash -c wrapper and is valid bash", () => {
    // The whole script is wrapped in bash -c '...'. A single quote inside closes
    // that wrapper early and silently breaks everything after it. The local-run
    // test above can't catch this on a dev machine that already has codex (the
    // install block is skipped), so guard the invariant directly.
    const prefix = "bash -c '";
    assert.ok(BOOTSTRAP_SCRIPT.startsWith(prefix));
    assert.ok(BOOTSTRAP_SCRIPT.endsWith("'"));
    const inner = BOOTSTRAP_SCRIPT.slice(prefix.length, -1);
    assert.doesNotMatch(inner, /'/, "no single quotes allowed inside the bash -c wrapper");
    const check = spawnSync("bash", ["-n", "-c", inner], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
  });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
