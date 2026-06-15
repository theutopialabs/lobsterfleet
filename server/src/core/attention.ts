export type SessionAttentionState = "" | "needs_input";

const ansiPattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripTerminalAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

export function terminalAttentionReason(value: string): string | null {
  const text = stripTerminalAnsi(value).replace(/\r/g, "\n");
  if (/do you trust the contents of this directory/i.test(text)) {
    return "Trust confirmation needed";
  }
  if (/press (enter|return) to continue/i.test(text)) {
    return "Waiting for confirmation";
  }
  if (/do you want to (continue|proceed|allow|run)/i.test(text)) {
    return "Waiting for confirmation";
  }
  if (/\bapproval required\b/i.test(text)) {
    return "Approval needed";
  }
  if (/\bwaiting for (user )?input\b/i.test(text)) {
    return "Waiting for input";
  }
  if (isCodexPromptScreen(text)) {
    return "Waiting for prompt";
  }
  if (/\b(choose|select) an? option\b/i.test(text)) {
    return "Waiting for a choice";
  }
  if (/(^|\n)\s*(?:[>_*\-]\s*)?1[.)]\s+.+\n\s*2[.)]\s+/i.test(text)) {
    return "Waiting for a menu choice";
  }
  return null;
}

function isCodexPromptScreen(text: string): boolean {
  const hasCodexStatus =
    /\bmodel:\s+\S+[\s\S]{0,80}\/model\b/i.test(text) ||
    /\bContext\s+\d+%\s+used\b/i.test(text);
  if (!hasCodexStatus) return false;
  return /(^|\n)\s*[\u203A\u2022_>\-]?\s*(Ask me a question|What are you working on today\?|Implement\s+\{feature\})\b/i.test(
    text,
  );
}

export function terminalAttentionFingerprint(value: string): string {
  const text = stripTerminalAnsi(value).replace(/\s+/g, " ").trim().slice(-2000);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function terminalInputClearsAttention(payload: Uint8Array): boolean {
  if (!payload.length) return false;
  const text = new TextDecoder().decode(payload);
  if (/[\r\n]/.test(text)) return true;
  const stripped = stripTerminalAnsi(text).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return stripped.trim().length > 0;
}
