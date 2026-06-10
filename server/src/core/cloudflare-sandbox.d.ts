// Type-only shim for @cloudflare/sandbox. We dropped the Cloudflare container
// runtime in the Node port, so none of these run, but the ported handler still
// has the old container codepaths (all guarded by env.SANDBOX, which is never
// set on Node). This shim keeps that dead code typechecking. The runtime values
// (getSandbox, ContainerProxy, the Sandbox base) live in cf-runtime.ts.
declare module "@cloudflare/sandbox" {
  export interface BackupOptions {
    dir: string;
    excludes?: string[];
    gitignore?: boolean;
    localBucket?: boolean;
    name: string;
  }
  export interface DirectoryBackup {
    id: string;
    [key: string]: unknown;
  }
  export interface SessionTerminatedError extends Error {
    code: string;
  }

  // Loose shapes for the exec/session surface the dead container code touches.
  export interface ExecResult {
    success: boolean;
    stdout: string;
    stderr: string;
    [key: string]: unknown;
  }
  export interface SandboxSession {
    exec(command: string, options?: unknown): Promise<ExecResult>;
    mkdir(path: string, options?: unknown): Promise<unknown>;
    setEnvVars(env: Record<string, string | undefined>): Promise<unknown>;
    terminal(request: Request, options?: unknown): Promise<Response>;
    [key: string]: unknown;
  }
  export interface Sandbox<_Env = unknown> {
    createSession(options: unknown): Promise<SandboxSession>;
    getSession(id: string): Promise<SandboxSession>;
    deleteSession(id: string): Promise<unknown>;
    createBackup(options: BackupOptions): Promise<DirectoryBackup>;
    restoreBackup(backup: DirectoryBackup): Promise<unknown>;
    mkdir(path: string, options?: unknown): Promise<unknown>;
    writeFile(path: string, contents: unknown, options?: unknown): Promise<unknown>;
    [key: string]: unknown;
  }

  // Base class to extend (value). The Node entry never instantiates it.
  export const Sandbox: {
    new <Env = unknown>(...args: unknown[]): Sandbox<Env>;
  };
  export const ContainerProxy: unknown;
  export function getSandbox<Env = unknown>(
    namespace: unknown,
    id: string,
  ): Sandbox<Env>;
}
