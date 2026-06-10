import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { staticFileForPath } from "../src/staticFiles.js";

describe("static file resolution", () => {
  it("serves real files inside the web dist", async () => {
    await withWebDist(async (root) => {
      const result = staticFileForPath(root, "/assets/app.js");

      assert.equal(result?.file, join(root, "assets/app.js"));
    });
  });

  it("falls back to index.html for app routes", async () => {
    await withWebDist(async (root) => {
      const result = staticFileForPath(root, "/admin");

      assert.equal(result?.file, join(root, "index.html"));
    });
  });

  it("does not serve index.html for missing assets", async () => {
    await withWebDist(async (root) => {
      assert.equal(staticFileForPath(root, "/assets/missing.js"), null);
      assert.equal(staticFileForPath(root, "/favicon.ico"), null);
    });
  });

  it("blocks decoded parent-directory segments", async () => {
    await withWebDist(async (root) => {
      assert.equal(staticFileForPath(root, "/%2e%2e/package.json"), null);
      assert.equal(staticFileForPath(root, "/assets/%2e%2e/index.html"), null);
    });
  });

  it("blocks malformed encoded paths", async () => {
    await withWebDist(async (root) => {
      assert.equal(staticFileForPath(root, "/%zz"), null);
    });
  });
});

async function withWebDist(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-web-"));
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), "<div id=\"root\"></div>");
    await writeFile(join(root, "assets/app.js"), "console.log('ok');");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
