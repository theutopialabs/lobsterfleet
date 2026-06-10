import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Tiny R2-shaped bucket backed by local files.
export function createLocalBucket(root: string): R2Bucket {
  const base = resolve(root);
  return {
    async get(key) {
      try {
        const bytes = await readFile(localPath(base, key));
        return { body: new Blob([bytes]).stream() } as R2Object;
      } catch {
        return null;
      }
    },
    async put(key, value) {
      const file = localPath(base, key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, await bytesFromValue(value));
      return {};
    },
    async delete(key) {
      await rm(localPath(base, key), { force: true });
    },
  };
}

function localPath(base: string, key: string): string {
  const file = resolve(base, key);
  if (!file.startsWith(`${base}/`) && file !== base) {
    throw new Error("archive key escapes archive dir");
  }
  return file;
}

async function bytesFromValue(value: unknown): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new TextEncoder().encode(String(value ?? ""));
}
