// Repo-flavored Combobox: owner dimmed, name bright, optional pill on rows
// that are already in use. Free text is allowed since the server validates
// repo access anyway.

import { Combobox, Highlight } from "../../components/Combobox";

export function RepoCombobox({
  value,
  onChange,
  options,
  pinned,
  loading,
  placeholder,
  pinnedLabel,
  onSubmit,
}: {
  value: string;
  onChange: (repo: string) => void;
  options: string[];
  pinned?: string[]; // repos shown with the pill
  loading?: boolean;
  placeholder?: string;
  pinnedLabel?: string;
  onSubmit?: (repo: string) => void;
}) {
  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      pinned={pinned}
      pinnedLabel={pinnedLabel}
      loading={loading}
      placeholder={placeholder ?? (loading ? "Loading repos…" : "org/repo, type to search")}
      renderOption={(repo, needle) => <RepoName repo={repo} needle={needle} />}
      onSubmit={onSubmit}
    />
  );
}

// owner dimmed, name bright, the matched part underlit in accent
function RepoName({ repo, needle }: { repo: string; needle: string }) {
  const [owner, ...rest] = repo.split("/");
  const name = rest.join("/");
  return (
    <span className="min-w-0 truncate">
      <Highlight text={`${owner}/`} needle={needle} className="text-[var(--color-faint)]" />
      <Highlight text={name} needle={needle} className="text-inherit" />
    </span>
  );
}
