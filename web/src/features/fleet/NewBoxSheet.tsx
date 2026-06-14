// New crabbox sheet. Leases a fresh interactive session through the broker.

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, endpoints, type CatalogMachine, type CatalogRegion } from "../../lib/api";
import { SESSION_RUNTIME_OPTIONS, runtimeLabel } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button } from "../../components/Button";
import { Combobox } from "../../components/Combobox";
import { Field, Input, Select, TextArea } from "../../components/Field";
import { Sheet } from "../../components/Sheet";
import { RepoCombobox } from "./RepoCombobox";

type BranchInfo = { branches: string[]; defaultBranch: string };

export function NewBoxSheet({
  open,
  onClose,
  repos,
}: {
  open: boolean;
  onClose: () => void;
  repos: string[];
}) {
  const { refresh, toast } = useStore();
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [runtime, setRuntime] = useState<string>("crabbox");
  const [region, setRegion] = useState("");
  const [machine, setMachine] = useState("");
  const [regions, setRegions] = useState<CatalogRegion[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [aptUpgrade, setAptUpgrade] = useState(false);
  const [command, setCommand] = useState("codex --yolo");
  const [prompt, setPrompt] = useState("");
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [agentsMd, setAgentsMd] = useState("");
  const [configToml, setConfigToml] = useState("");
  const [loadingCodexDefaults, setLoadingCodexDefaults] = useState(false);
  const [busy, setBusy] = useState(false);
  // branch lists keyed by repo so flipping between repos doesn't refetch
  const [branchCache, setBranchCache] = useState<Record<string, BranchInfo>>({});
  const [fetchingBranches, setFetchingBranches] = useState<string | null>(null);
  const [branchErrorRepo, setBranchErrorRepo] = useState<string | null>(null);
  // last branch we set automatically, so we know when the user typed their own
  const autoBranch = useRef("main");
  const agentsDirty = useRef(false);
  const configDirty = useRef(false);

  // Region + machine come from the broker's live catalog (Hetzner locations and
  // server types, or the local Docker runner). Hide regions with nothing
  // placeable right now (e.g. a sold-out Hetzner location) so you can't pick a
  // dead end. Machines are scoped to the region and grouped shared vs dedicated.
  const availableRegions = useMemo(
    () => regions.filter((r) => (r.machines ?? []).some((m) => m.available !== false)),
    [regions],
  );
  const machines = useMemo(() => {
    const inRegion = availableRegions.find((r) => r.id === region)?.machines ?? [];
    return inRegion.filter((m) => m.available !== false);
  }, [availableRegions, region]);
  const machineGroups = useMemo(() => groupMachines(machines), [machines]);

  const repoKey = repo.trim();
  const branchInfo = branchCache[repoKey];
  const loadingBranches = fetchingBranches === repoKey;
  const branchError = branchErrorRepo === repoKey;

  // default to the first allowlisted repo once the sheet opens
  useEffect(() => {
    if (open && !repo && repos[0]) setRepo(repos[0]);
  }, [open, repo, repos]);

  // pull the branch list once the picked repo is a real allowlisted one
  useEffect(() => {
    const target = repo.trim();
    if (!open || !target || !repos.includes(target) || branchCache[target]) return;
    setFetchingBranches(target);
    setBranchErrorRepo(null);
    endpoints
      .githubBranches(target)
      .then((data) => setBranchCache((c) => ({ ...c, [target]: data })))
      .catch(() => setBranchErrorRepo(target)) // no token or not allowed, free text still works
      .finally(() => setFetchingBranches((f) => (f === target ? null : f)));
  }, [open, repo, repos, branchCache]);

  // adopt the repo's default branch unless the user typed their own
  useEffect(() => {
    const data = branchCache[repo.trim()];
    if (!data) return;
    setBranch((b) => (!b || b === autoBranch.current ? data.defaultBranch : b));
    autoBranch.current = data.defaultBranch;
  }, [repo, branchCache]);

  // pull the broker catalog once the sheet opens
  useEffect(() => {
    if (!open) return;
    setLoadingCatalog(true);
    endpoints
      .boxCatalog()
      .then((data) => setRegions(data.regions))
      .catch(() => setRegions([])) // broker down/unset: lease falls back to defaults
      .finally(() => setLoadingCatalog(false));
  }, [open]);

  // Load editable Codex files from defaults/codex each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    agentsDirty.current = false;
    configDirty.current = false;
    setLoadingCodexDefaults(true);
    endpoints
      .codexDefaults()
      .then((data) => {
        if (!agentsDirty.current) setAgentsMd(data.agentsMd);
        if (!configDirty.current) setConfigToml(data.configToml);
      })
      .catch(() => {
        if (!agentsDirty.current) setAgentsMd("");
        if (!configDirty.current) setConfigToml("");
      })
      .finally(() => setLoadingCodexDefaults(false));
  }, [open]);

  // default the region to the first one with availability once the catalog arrives
  useEffect(() => {
    if (open && !region && availableRegions[0]) setRegion(availableRegions[0].id);
  }, [open, region, availableRegions]);

  // keep the machine valid for the picked region (default to the first one)
  useEffect(() => {
    if (!open) return;
    if (machines.some((m) => m.id === machine)) return;
    setMachine(machines[0]?.id ?? "");
  }, [open, machine, machines]);

  const submit = async () => {
    if (!repo) {
      toast("Pick a repo first", "warn");
      return;
    }
    setBusy(true);
    try {
      await endpoints.createSession({
        repo,
        branch,
        runtime,
        region: region || undefined,
        machine: machine || undefined,
        aptUpgrade,
        command,
        prompt: prompt || undefined,
        configToml,
        agentsMd,
      });
      toast("Crabbox requested. Provisioning through the broker.");
      onClose();
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not lease crabbox";
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New crabbox"
      subtitle="Lease a fresh workspace and drop an agent in it."
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={submit}>
            Lease crabbox
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Repo">
            <RepoCombobox
              value={repo}
              onChange={setRepo}
              options={repos}
              placeholder={repos.length === 0 ? "No repos. Add one in Admin" : undefined}
            />
          </Field>
          <Field label="Branch" hint={branchError ? "couldn't load branches" : undefined}>
            <Combobox
              value={branch}
              onChange={setBranch}
              options={branchInfo?.branches ?? []}
              loading={loadingBranches}
              pinned={branchInfo ? [branchInfo.defaultBranch] : []}
              pinnedLabel="default"
              placeholder="main"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Runtime">
            <Select value={runtime} onChange={(e) => setRuntime(e.target.value)}>
              {SESSION_RUNTIME_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {runtimeLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Region"
            hint={
              loadingCatalog
                ? "loading…"
                : availableRegions.length === 0
                  ? "broker default"
                  : undefined
            }
          >
            <Select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              disabled={availableRegions.length === 0}
            >
              {availableRegions.length === 0 && <option value="">Default</option>}
              {availableRegions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Machine"
          hint={!loadingCatalog && machines.length === 0 ? "broker default" : undefined}
        >
          <Select
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            disabled={machines.length === 0}
          >
            {machines.length === 0 && <option value="">Default</option>}
            {machineGroups.length === 1 && machineGroups[0].label === ""
              ? machineGroups[0].machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {machineLabel(m)}
                  </option>
                ))
              : machineGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {machineLabel(m)}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </Select>
        </Field>

        <label className="flex cursor-pointer select-none items-center gap-3">
          <input
            type="checkbox"
            checked={aptUpgrade}
            onChange={(e) => setAptUpgrade(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[#6d5efc]"
          />
          <span className="text-sm text-white/80">
            Run <code className="font-mono text-white/90">apt upgrade -y</code> on startup
          </span>
          <span className="text-xs text-white/40">slower boot</span>
        </label>

        <Field label="Command" hint="starts in tmux when the box is ready">
          <Input value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono" />
        </Field>

        <Field label="Prompt" hint="optional">
          <TextArea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent work on?"
          />
        </Field>

        <CodexFileBox
          label="AGENTS.md"
          open={agentsOpen}
          value={agentsMd}
          loading={loadingCodexDefaults}
          placeholder="Instructions to place at ~/.codex/AGENTS.md inside this crabbox"
          onToggle={() => setAgentsOpen((next) => !next)}
          onChange={(value) => {
            agentsDirty.current = true;
            setAgentsMd(value);
          }}
        />

        <CodexFileBox
          label="config.toml"
          open={configOpen}
          value={configToml}
          loading={loadingCodexDefaults}
          placeholder="Config to place at ~/.codex/config.toml inside this crabbox"
          onToggle={() => setConfigOpen((next) => !next)}
          onChange={(value) => {
            configDirty.current = true;
            setConfigToml(value);
          }}
        />
      </div>
    </Sheet>
  );
}

function CodexFileBox({
  label,
  open,
  value,
  loading,
  placeholder,
  onToggle,
  onChange,
}: {
  label: string;
  open: boolean;
  value: string;
  loading: boolean;
  placeholder: string;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  const meta = loading ? "loading" : value.trim() ? `${value.length} chars` : "optional";
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white/[0.02]">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60"
      >
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-faint)]">
          {label}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
          {meta}
          <span className={`text-sm transition-transform ${open ? "rotate-90" : ""}`}>
            &gt;
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-line)] p-3">
          <TextArea
            rows={8}
            maxLength={20000}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono"
            placeholder={placeholder}
          />
        </div>
      )}
    </div>
  );
}

type MachineGroup = { label: string; machines: CatalogMachine[] };

// Split machines into "Shared" / "Dedicated" by Hetzner's cpu_type. When there's
// no tier info (the local Docker runner) we return one unlabeled group so the UI
// renders a flat list instead of an empty optgroup header.
function groupMachines(machines: CatalogMachine[]): MachineGroup[] {
  const shared = machines.filter((m) => m.cpuType === "shared");
  const dedicated = machines.filter((m) => m.cpuType === "dedicated");
  const other = machines.filter((m) => m.cpuType !== "shared" && m.cpuType !== "dedicated");
  if (!shared.length && !dedicated.length) {
    return other.length ? [{ label: "", machines: other }] : [];
  }
  const groups: MachineGroup[] = [];
  if (shared.length) groups.push({ label: "Shared", machines: shared });
  if (dedicated.length) groups.push({ label: "Dedicated", machines: dedicated });
  if (other.length) groups.push({ label: "Other", machines: other });
  return groups;
}

// "cpx22 · 3 vCPU · 4 GB · 80 GB disk · €0.007/h" for Hetzner.
// Falls back to the friendly name when there are no specs.
function machineLabel(m: CatalogMachine): string {
  const specs = [
    m.cpuCores ? `${m.cpuCores} vCPU` : "",
    m.memoryGb ? `${m.memoryGb} GB` : "",
    m.diskGb ? `${m.diskGb} GB disk` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const gross = m.priceHourly?.gross;
  const price = gross ? ` · €${Number(gross).toFixed(3)}/h` : "";
  if (!specs) return m.name || m.id;
  return `${m.id} · ${specs}${price}`;
}
