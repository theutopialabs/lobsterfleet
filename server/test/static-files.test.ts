import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { staticCacheControl, staticFileForPath } from "../src/staticFiles.js";

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

  it("only marks hashed assets immutable", () => {
    assert.equal(staticCacheControl(join("/app/dist", "index.html")), "no-store");
    assert.equal(
      staticCacheControl(join("/app/dist/assets", "app-a1b2c3d4.js")),
      "public, max-age=31536000, immutable",
    );
    assert.equal(
      staticCacheControl(join("/app/dist/assets", "app-a1b2c3d4.js.map")),
      "public, max-age=31536000, immutable",
    );
    assert.equal(staticCacheControl(join("/app/dist/assets", "app.js")), "public, max-age=3600");
    assert.equal(staticCacheControl(join("/app/dist", "favicon.ico")), "public, max-age=3600");
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
