// Admin view. Four panels for owners: allowlist, repos, policy, and CRABBOX.md
// workflows. Each panel hits an /api/admin/* endpoint and then refreshes state.

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { ApiError, endpoints } from "../../lib/api";
import type { AllowEntry, RepoWorkflow, Role, RuntimePreflight } from "../../lib/api";
import { useStore } from "../../lib/store";
import { Button, IconButton } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Field, Input, Select } from "../../components/Field";
import { Panel } from "../../components/Panel";
import { Chip, Pill, StatePill, toneForStatus } from "../../components/Pill";
import { RepoCombobox } from "../fleet/RepoCombobox";

const ROLES: Role[] = ["viewer", "maintainer", "owner"];
// policy option lists match the server validators
const RETENTION = ["14", "30", "60"];
const MERGE = ["guarded", "maintainers", "disabled"];

export function AdminView() {
  const { state, user } = useStore();

  // owners only. everyone else gets a soft gate.
  if (user?.role !== "owner") {
    return (
      <div className="w-full pt-6">
        <EmptyState
          icon={<ShieldCheck size={26} strokeWidth={1.8} />}
          title="Owner only"
          body="Admin controls the allowlist, repos, policy and workflows. Ask an owner for access."
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-[var(--color-muted)]">
          Who gets in, which repos run, and how the fleet behaves.
        </p>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PreflightPanel preflight={state?.preflight ?? null} />
        <AllowPanel entries={state?.allow ?? []} />
        <ReposPanel repos={state?.repos ?? []} />
        <PolicyPanel
          cap={state?.cap ?? 20}
          retention={state?.retention ?? "30"}
          merge={state?.merge ?? "guarded"}
        />
        <WorkflowsPanel workflows={state?.workflows ?? []} repos={state?.repos ?? []} />
      </div>
    </div>
  );
}

function PreflightPanel({ preflight }: { preflight: RuntimePreflight | null }) {
  const items = preflight?.items ?? [];
  const counts = items.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { ok: 0, warning: 0, missing: 0, error: 0 },
  );

  return (
    <Panel className="lg:col-span-2">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PanelHead
          title="Production preflight"
          hint="runtime config checks from this server"
        />
        <div className="flex flex-wrap gap-2">
          {preflight ? (
            <>
              <Pill tone={preflightTone(preflight.status)}>
                {preflight.status}
              </Pill>
              <Chip>{counts.ok} ready</Chip>
              {(counts.missing > 0 || counts.error > 0 || counts.warning > 0) && (
                <Chip>{counts.missing + counts.error + counts.warning} need work</Chip>
              )}
            </>
          ) : (
            <Pill tone="neutral">not loaded</Pill>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-[var(--color-line)] bg-white/[0.02] p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium text-[var(--color-ink)]">
                {item.label}
              </span>
              <Pill tone={preflightTone(item.status)}>{item.status}</Pill>
            </div>
            <p className="break-words text-xs leading-5 text-[var(--color-muted)]">{item.detail}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function preflightTone(status: RuntimePreflight["status"]) {
  if (status === "ok") return "success";
  if (status === "error") return "danger";
  return "warning";
}

// Section header used inside each panel.
function PanelHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h2>
      <p className="mt-0.5 text-xs text-[var(--color-faint)]">{hint}</p>
    </div>
  );
}

// Users / teams allowlist.
function AllowPanel({ entries }: { entries: AllowEntry[] }) {
  const { refresh, toast } = useStore();
  const [value, setValue] = useState("");
  const [role, setRole] = useState<Role>("maintainer");
  const [busy, setBusy] = useState<string | null>(null);

  const add = async () => {
    const v = value.trim();
    if (!v) return;
    setBusy("add");
    try {
      await endpoints.addAllow(v, role);
      toast(`Allowed ${v}`);
      setValue("");
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not add", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (v: string) => {
    setBusy(v);
    try {
      await endpoints.removeAllow(v);
      toast(`Removed ${v}`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not remove", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel>
      <PanelHead title="Allowlist" hint="logins, emails or @org/teams that can sign in" />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Identity">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="octocat or @org/team"
            />
          </Field>
        </div>
        <div className="w-32">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button variant="primary" busy={busy === "add"} onClick={add}>
          Add
        </Button>
      </div>

      <div className="mt-4 flex flex-col divide-y divide-[var(--color-line-soft)]">
        {entries.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--color-faint)]">
            No allowlist entries yet.
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.value} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink)]">
                {e.value}
              </span>
              <Pill tone={e.role === "owner" ? "accent" : "neutral"}>{e.role}</Pill>
              <IconButton
                label={`Remove ${e.value}`}
                onClick={() => remove(e.value)}
                className={busy === e.value ? "opacity-50" : "hover:text-[var(--color-danger)]"}
              >
                ✕
              </IconButton>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

// Repo allowlist. Pick from the GitHub token's repos or type any org/repo.
function ReposPanel({ repos }: { repos: string[] }) {
  const { refresh, toast } = useStore();
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [githubRepos, setGithubRepos] = useState<string[] | null>(null);

  // pull the GitHub repo list once when the panel mounts
  useEffect(() => {
    endpoints
      .githubRepos()
      .then((data) => setGithubRepos(data.repos))
      .catch(() => setGithubRepos([])); // no token or GitHub down, free text still works
  }, []);

  // only suggest repos that aren't allowlisted yet
  const options = (githubRepos ?? []).filter((r) => !repos.includes(r));

  const add = async () => {
    const v = repo.trim();
    if (!v) return;
    setBusy("add");
    try {
      await endpoints.addRepo(v);
      toast(`Added ${v}`);
      setRepo("");
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not add", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (v: string) => {
    setBusy(v);
    try {
      await endpoints.removeRepo(v);
      toast(`Removed ${v}`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not remove", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel>
      <PanelHead title="Repos" hint="pick from your GitHub repos or type any org/repo" />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Repository">
            <RepoCombobox
              value={repo}
              onChange={setRepo}
              options={options}
              loading={githubRepos === null}
              onSubmit={add}
            />
          </Field>
        </div>
        <Button variant="primary" busy={busy === "add"} onClick={add}>
          Add
        </Button>
      </div>

      <div className="mt-4 flex flex-col divide-y divide-[var(--color-line-soft)]">
        {repos.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--color-faint)]">
            No repos allowlisted yet.
          </div>
        ) : (
          repos.map((r) => (
            <div key={r} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--color-ink)]">
                {r}
              </span>
              <IconButton
                label={`Remove ${r}`}
                onClick={() => remove(r)}
                className={busy === r ? "opacity-50" : "hover:text-[var(--color-danger)]"}
              >
                ✕
              </IconButton>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

// Fleet policy: concurrent cap, merge mode, log retention.
function PolicyPanel({
  cap,
  retention,
  merge,
}: {
  cap: number;
  retention: string;
  merge: string;
}) {
  const { refresh, toast } = useStore();
  const [capValue, setCapValue] = useState(String(cap));
  const [retentionValue, setRetentionValue] = useState(retention);
  const [mergeValue, setMergeValue] = useState(merge);
  const [busy, setBusy] = useState(false);

  // follow server changes (another owner saving) so Save never writes stale values
  useEffect(() => {
    setCapValue(String(cap));
    setRetentionValue(retention);
    setMergeValue(merge);
  }, [cap, retention, merge]);

  const save = async () => {
    setBusy(true);
    try {
      await endpoints.updatePolicy({
        cap: Number(capValue) || 20,
        retention: retentionValue,
        merge: mergeValue,
      });
      toast("Policy saved");
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save policy", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHead title="Policy" hint="concurrency, merge mode and log retention" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Concurrent cap" hint="1 to 200">
          <Input
            type="number"
            min={1}
            max={200}
            value={capValue}
            onChange={(e) => setCapValue(e.target.value)}
          />
        </Field>
        <Field label="Direct merge">
          <Select value={mergeValue} onChange={(e) => setMergeValue(e.target.value)}>
            {MERGE.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Log retention" hint="days">
          <Select value={retentionValue} onChange={(e) => setRetentionValue(e.target.value)}>
            {RETENTION.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" busy={busy} onClick={save}>
          Save policy
        </Button>
      </div>
    </Panel>
  );
}

// CRABBOX.md workflows. List each repo's status and re-evaluate one.
function WorkflowsPanel({
  workflows,
  repos,
}: {
  workflows: RepoWorkflow[];
  repos: string[];
}) {
  const { refresh, toast } = useStore();
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);

  const evaluate = async () => {
    const target = repo || repos[0];
    if (!target) {
      toast("Add a repo first", "warn");
      return;
    }
    setBusy(true);
    try {
      await endpoints.evaluateWorkflow(target);
      toast(`Evaluated ${target}`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not evaluate", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHead title="Workflows" hint="CRABBOX.md prompts the fleet reads per repo" />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Repository">
            <Select value={repo} onChange={(e) => setRepo(e.target.value)}>
              {repos.length === 0 && <option value="">No repos allowlisted</option>}
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button variant="ghost" busy={busy} onClick={evaluate}>
          Evaluate
        </Button>
      </div>

      <div className="mt-4 flex flex-col divide-y divide-[var(--color-line-soft)]">
        {workflows.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--color-faint)]">
            No workflows evaluated yet.
          </div>
        ) : (
          workflows.map((w) => (
            <div key={w.repo} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm text-[var(--color-ink)]">{w.repo}</div>
                {w.error ? (
                  <div className="mt-0.5 truncate text-[11px] text-[var(--color-danger)]">{w.error}</div>
                ) : (
                  w.prompt && (
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-faint)]">
                      {w.prompt}
                    </div>
                  )
                )}
              </div>
              {w.status === "ok" ? (
                <StatePill status="ok" label="ok" />
              ) : (
                <Chip>
                  <span style={{ color: `var(--color-${toneColorVar(w.status)})` }}>{w.status}</span>
                </Chip>
              )}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

// map a workflow status to a token color name for the chip text
function toneColorVar(status: string): string {
  const tone = toneForStatus(status === "missing" || status === "invalid" ? "failed" : status);
  return tone === "danger" ? "danger" : tone === "warning" ? "warning" : "muted";
}
