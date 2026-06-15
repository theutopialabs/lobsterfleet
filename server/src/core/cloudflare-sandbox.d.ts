// Type-only shim for @cloudflare/sandbox. We dropped the Cloudflare container
// runtime in the Node port, so none of these run. The handler only pulls a
// couple of types (DirectoryBackup, Sandbox) from here for env.SANDBOX-guarded
// branches that never fire on Node. This shim just keeps those types compiling.
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

}
