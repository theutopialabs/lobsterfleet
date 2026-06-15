import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export const appRoot = resolve(here, "../..");

export function resolveRuntimePath(path: string, base = appRoot): string {
  return isAbsolute(path) ? path : resolve(base, path);
}
