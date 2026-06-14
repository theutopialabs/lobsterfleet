// Settings view. Light read-only snapshot of this self-hosted instance: org,
// the signed-in user, current policy, and which auth methods are wired up.
// Owners edit policy over in Admin, this is just the at-a-glance picture.

import { useStore } from "../../lib/store";
import { mergePolicyLabel } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { Chip, Pill } from "../../components/Pill";

export function SettingsView() {
  const { state, user, connected } = useStore();

  const rows: { label: string; value: string }[] = [
    { label: "Org", value: state?.org || "self-hosted" },
    { label: "Concurrent cap", value: String(state?.cap ?? "-") },
    { label: "Merge mode", value: state?.merge ? mergePolicyLabel(state.merge) : "-" },
    { label: "Log retention", value: state?.retention ? `${state.retention} days` : "-" },
  ];

  const auth = state?.auth;
  const methods: { label: string; on: boolean }[] = [
    { label: "GitHub OAuth", on: Boolean(auth?.github) },
    { label: "Bootstrap token", on: Boolean(auth?.token) },
    { label: "Dev identity", on: Boolean(auth?.devIdentity) },
  ];

  return (
    <div className="w-full">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-[var(--color-muted)]">
          This instance at a glance. Owners tune policy in Admin.
        </p>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel>
          <h2 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">Instance</h2>
          <dl className="flex flex-col divide-y divide-[var(--color-line-soft)]">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between py-2.5">
                <dt className="text-xs uppercase tracking-wider text-[var(--color-faint)]">
                  {r.label}
                </dt>
                <dd className="text-sm tabular-nums text-[var(--color-ink)]">{r.value}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-xs uppercase tracking-wider text-[var(--color-faint)]">Server</dt>
              <dd>
                <Pill tone={connected ? "success" : "danger"}>
                  {connected ? "connected" : "offline"}
                </Pill>
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel>
          <h2 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">Signed in</h2>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-accent)]/20 text-sm font-medium text-[var(--color-accent-2)]">
              {user?.login?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm text-[var(--color-ink)]">
                {user?.name || user?.login || "guest"}
              </div>
              <div className="truncate text-xs text-[var(--color-faint)]">
                {user?.email || user?.subject || ""}
              </div>
            </div>
            {user?.role && <Pill tone="accent">{user.role}</Pill>}
          </div>
          {user?.teams && user.teams.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {user.teams.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="md:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">Connections</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {methods.map((m) => (
              <div
                key={m.label}
                className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-3 py-2.5"
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                    m.on
                      ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                      : "bg-white/[0.05] text-[var(--color-faint)]"
                  }`}
                >
                  {m.on ? "✓" : "·"}
                </span>
                <span className="text-sm text-[var(--color-ink)]">{m.label}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
