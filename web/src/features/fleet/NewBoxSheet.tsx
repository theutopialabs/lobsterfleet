// New crabbox sheet. Leases a fresh interactive session through the broker.

import { useEffect, useState } from "react";
import { ApiError, endpoints } from "../../lib/api";
import { SESSION_RUNTIME_OPTIONS, runtimeLabel } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button } from "../../components/Button";
import { Field, Input, Select, TextArea } from "../../components/Field";
import { Sheet } from "../../components/Sheet";

export function NewBoxSheet({
  open,
  onClose,
  repos,
}: {
  open: boolean;
  onClose: () => void;
  repos: string[];
}) {
  const { state, refresh, toast } = useStore();
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [runtime, setRuntime] = useState<string>("crabbox");
  const [size, setSize] = useState("");
  const [command, setCommand] = useState("codex --yolo");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  // Box sizes come from the server (env-overridable), so we render whatever it
  // sends instead of baking a list into the UI.
  const sizes = state?.sizes ?? [];

  // default the repo once the list arrives
  useEffect(() => {
    if (open && !repo && repos[0]) setRepo(repos[0]);
  }, [open, repo, repos]);

  // default the size to the server's pick once state arrives
  useEffect(() => {
    if (open && !size && state) setSize(state.defaultSize || sizes[0]?.id || "");
  }, [open, size, state, sizes]);

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
        size: size || undefined,
        command,
        prompt: prompt || undefined,
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
            <Select value={repo} onChange={(e) => setRepo(e.target.value)}>
              {repos.length === 0 && <option value="">No repos allowlisted</option>}
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Branch">
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
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
          <Field label="Size">
            <Select value={size} onChange={(e) => setSize(e.target.value)}>
              {sizes.length === 0 && <option value="">Default</option>}
              {sizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Command" hint="runs on attach">
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
      </div>
    </Sheet>
  );
}
