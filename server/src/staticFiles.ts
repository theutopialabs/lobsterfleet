import { statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

export type StaticFileResult = {
  file: string;
};

export function staticFileForPath(webDist: string, pathname: string): StaticFileResult | null {
  const root = resolve(webDist);
  const decoded = decodedPath(pathname);
  if (!decoded || decoded.includes("\0") || hasParentSegment(decoded)) return null;

  const requestPath = decoded === "/" || decoded === "" ? "/index.html" : decoded;
  const candidate = resolve(root, `.${requestPath}`);
  if (!insideRoot(root, candidate)) return null;

  if (isFile(candidate)) {
    return { file: candidate };
  }

  if (assetLikePath(requestPath)) return null;

  const index = resolve(root, "index.html");
  return isFile(index) ? { file: index } : null;
}

const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}(?:\.[^./\\]+)+$/;

export function staticCacheControl(file: string): string {
  if (extname(file) === ".html") return "no-store";
  const normalized = file.replaceAll("\\", "/");
  if (normalized.includes("/assets/") && HASHED_ASSET.test(basename(file))) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

function decodedPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function hasParentSegment(pathname: string): boolean {
  return pathname.split(/[\\/]+/).some((part) => part === "..");
}

function assetLikePath(pathname: string): boolean {
  return pathname.startsWith("/assets/") || Boolean(extname(pathname));
}

function insideRoot(root: string, file: string): boolean {
  return file === root || file.startsWith(`${root}/`);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
