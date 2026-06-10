// New card sheet. Creates a card on the Todo lane.

import { useEffect, useState } from "react";
import { ApiError, endpoints } from "../../lib/api";
import type { GitHubReference } from "../../lib/api";
import {
  CARD_SOURCE_OPTIONS,
  MERGE_POLICY_OPTIONS,
  RUNTIME_OPTIONS,
  mergePolicyLabel,
  runtimeLabel,
} from "../../lib/format";
import { useStore } from "../../lib/store";
import { Button } from "../../components/Button";
import { Field, Input, Select, TextArea } from "../../components/Field";
import { Sheet } from "../../components/Sheet";

export function NewCardSheet({
  open,
  onClose,
  repos,
  seed,
}: {
  open: boolean;
  onClose: () => void;
  repos: string[];
  // optional prefill coming from a #123 GitHub ref match
  seed?: GitHubReference | null;
}) {
  const { refresh, toast } = useStore();
  const [source, setSource] = useState<string>("Prompt");
  const [repo, setRepo] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [runtime, setRuntime] = useState<string>("auto");
  const [policy, setPolicy] = useState<string>("open_pr");
  const [busy, setBusy] = useState(false);

  // default repo + apply a seed from a github ref when the sheet opens.
  // a blank open clears leftovers from a previous seeded visit.
  useEffect(() => {
    if (!open) return;
    setRepo((cur) => cur || seed?.repo || repos[0] || "");
    if (seed) {
      setSource(seed.source === "PR" ? "PR" : "Issue");
      setTitle(`#${seed.number} ${seed.title}`);
      setPrompt(seed.body || `Work on ${seed.repo}#${seed.number}: ${seed.title}`);
    } else {
      setSource("Prompt");
      setTitle("");
      setPrompt("");
    }
    // only re-seed when the seed identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed]);

  const submit = async () => {
    if (!repo || !prompt.trim()) {
      toast("Repo and prompt are required", "warn");
      return;
    }
    setBusy(true);
    try {
      await endpoints.createCard({
        repo,
        prompt,
        title: title || undefined,
        source,
        runtime,
        policy,
      });
      toast("Card created on Todo");
      onClose();
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not create card";
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New card"
      subtitle="Queue a task. It lands on Todo and you can pulse it live."
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={submit}>
            Create card
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            {CARD_SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

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

        <Field label="Title" hint="optional">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Derived from the prompt if blank"
          />
        </Field>

        <Field label="Prompt">
          <TextArea
            rows={6}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do?"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Runtime">
            <Select value={runtime} onChange={(e) => setRuntime(e.target.value)}>
              {RUNTIME_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {runtimeLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Merge policy">
            <Select value={policy} onChange={(e) => setPolicy(e.target.value)}>
              {MERGE_POLICY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {mergePolicyLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
