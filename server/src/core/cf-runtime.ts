// Runtime stubs for the Cloudflare sandbox values the ported handler imports.
// The Node port dropped the container runtime, so these never actually run:
// every caller is behind an env.SANDBOX check, and env.SANDBOX is never set on
// Node. If something does reach here it means a container codepath slipped
// through, so we throw a clear "use crabbox" error.
import type { Sandbox } from "@cloudflare/sandbox";

const NOT_SUPPORTED =
  "Cloudflare Sandbox runtime is not available on the Node host. Use a crabbox lease instead.";

// Re-exported by index.ts to satisfy the old `export { ContainerProxy }`. Nothing
// references it at runtime in the Node port.
export const ContainerProxy: unknown = undefined;

export function getSandbox<Env = unknown>(_namespace: unknown, _id: string): Sandbox<Env> {
  throw new Error(NOT_SUPPORTED);
}
