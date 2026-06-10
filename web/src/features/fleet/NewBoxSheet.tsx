// New crabbox sheet. Leases a fresh interactive session through the broker.

import { useEffect, useState } from "react";
import { ApiError, endpoints } from "../../lib/api";
import { SESSION_RUNTIME_OPTIONS } from "../../lib/format";
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
  const { refresh, toast } = useStore();
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [runtime, setRuntime] = useState<string>("crabbox");
  const [command, setCommand] = useState("codex --yolo");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  // default the repo once the list arrives
  useEffect(() => {
    if (open && !repo && repos[0]) setRepo(repos[0]);
  }, [open, repo, repos]);

  const submit = async () => {
    if (!repo) {
      toast("Pick a repo first", "warn");
      return;
    }
    setBusy(true);
    try {
      await endpoints.createSession({ repo, branch, runtime, command, prompt: prompt || undefined });
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

        <div className="grid grid-cols-2 gap-4">
          <Field label="Branch">
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
          </Field>
          <Field label="Runtime">
            <Select value={runtime} onChange={(e) => setRuntime(e.target.value)}>
              {SESSION_RUNTIME_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === "crabbox" ? "Crabbox (VNC)" : "Container"}
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
