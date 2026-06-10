// Small label and time helpers shared across views.

import type { InteractiveSessionStatus, Lane } from "./api";

export const LANES: Lane[] = ["Todo", "Running", "Human Review", "Done"];

export const RUNTIME_OPTIONS = ["auto", "crabbox", "crabbox-gui"] as const;
export const SESSION_RUNTIME_OPTIONS = ["crabbox", "crabbox-gui"] as const;

// Human label for a runtime token. The two crabbox flavors read as TUI vs GUI.
export function runtimeLabel(runtime: string): string {
  return (
    {
      auto: "Auto",
      crabbox: "Crabbox (TUI)",
      "crabbox-gui": "Crabbox (GUI)",
    }[runtime] ?? runtime
  );
}
export const MERGE_POLICY_OPTIONS = [
  "open_pr",
  "merge_when_green",
  "fix_until_green_and_merge",
] as const;
export const CARD_SOURCE_OPTIONS = ["Prompt", "Issue", "PR"] as const;

// Short relative time like "3m" or "2h" since a unix ms timestamp.
export function elapsed(value: number | null | undefined): string {
  // no timestamp yet -> show a dash, not a made-up "0m"
  if (!value) return "—";
  const mins = Math.max(1, Math.floor((Date.now() - value) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Pretty single-char diff status.
export function diffStatusChar(status: string): string {
  return { added: "A", deleted: "D", modified: "M", renamed: "R" }[status] ?? "M";
}

// Human merge policy label.
export function mergePolicyLabel(policy: string): string {
  return (
    {
      open_pr: "Open PR",
      merge_when_green: "Merge when green",
      fix_until_green_and_merge: "Fix until green",
      guarded: "Guarded",
    }[policy] ?? policy
  );
}

// Pretty interactive session status.
export function sessionStatusLabel(status: InteractiveSessionStatus): string {
  return (
    {
      provisioning: "Provisioning",
      pending_adapter: "Pending adapter",
      ready: "Ready",
      attached: "Attached",
      detached: "Detached",
      stopped: "Stopped",
      expired: "Expired",
      failed: "Failed",
    }[status] ?? status
  );
}

// Is a session still alive (not in a terminal state)?
export function sessionIsActive(status: InteractiveSessionStatus): boolean {
  return ["provisioning", "pending_adapter", "ready", "attached", "detached"].includes(status);
}

// Finished = released/dead. The box is gone; the record is just history and can
// be cleared. Matches the server's deadInteractiveSessionStatuses.
export function sessionIsFinished(status: InteractiveSessionStatus): boolean {
  return ["stopped", "expired", "failed"].includes(status);
}

// First non-empty line of a prompt, used for card titles and excerpts.
export function firstLine(text: string): string {
  return (
    String(text || "")
      .split(/\r?\n/)
      .map((p) => p.trim())
      .find(Boolean) ?? ""
  );
}

// Only the GUI crabbox has a viewable desktop. TUI and container are headless.
export function runtimeHasVnc(runtime: string): boolean {
  return runtime === "crabbox-gui";
}
