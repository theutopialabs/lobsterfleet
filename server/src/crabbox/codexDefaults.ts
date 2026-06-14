import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRuntimePath } from "../runtimePaths.js";

const DEFAULTS_DIR = "defaults/codex";

export type ProjectCodexDefaults = {
  agentsMd: string | null;
  configToml: string | null;
  paths: {
    agentsMd: string;
    configToml: string;
  };
};

export type ProjectCodexDefaultsResponse = {
  agentsMd: string;
  configToml: string;
  paths: ProjectCodexDefaults["paths"];
};

export function readProjectCodexDefaults(): ProjectCodexDefaults {
  return {
    agentsMd: readDefault("AGENTS.md"),
    configToml: readDefault("config.toml"),
    paths: {
      agentsMd: `${DEFAULTS_DIR}/AGENTS.md`,
      configToml: `${DEFAULTS_DIR}/config.toml`,
    },
  };
}

function readDefault(name: "AGENTS.md" | "config.toml"): string | null {
  try {
    return readFileSync(join(resolveRuntimePath(DEFAULTS_DIR), name), "utf8");
  } catch {
    return null;
  }
}

export function readProjectCodexDefaultsResponse(): ProjectCodexDefaultsResponse {
  const defaults = readProjectCodexDefaults();
  return {
    agentsMd: defaults.agentsMd ?? "",
    configToml: defaults.configToml ?? "",
    paths: defaults.paths,
  };
}
