import { useState } from "react";
import { m1 } from "../lib/api";
import { errorMessage } from "../lib/hooks";
import { Button, Card, CardHeader } from "./ui";
import type { M1Brand, M1BrandInput } from "../lib/types";

const inputClass =
  "w-full rounded border border-line bg-ink px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-action/60 focus:outline-none";

type BrandListKey = Exclude<keyof M1BrandInput, "name">;

const LIST_FIELDS: { key: BrandListKey; label: string; placeholder: string }[] = [
  { key: "officialDomains", label: "Official domains", placeholder: "acme.example\nsupport.acme.example" },
  { key: "officialHandles", label: "Official handles", placeholder: "@acme\n@acme_support" },
  { key: "appDevelopers", label: "App developers", placeholder: "Acme Corp" },
  { key: "packagePrefixes", label: "Package prefixes", placeholder: "com.acme." },
  { key: "keywords", label: "Keywords", placeholder: "acme support" },
];

/** One entry per line (commas also split); up to 20 entries per list. */
function parseList(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function BrandFormCard({
  initial,
  onSaved,
  onCancel,
}: {
  /** Present when editing — PATCHes the existing brand. */
  initial?: M1Brand | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [lists, setLists] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      LIST_FIELDS.map(({ key }) => [key, (initial?.[key] as string[] | undefined)?.join("\n") ?? ""]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Brand name must be at least 2 characters.");
      return;
    }
    const payload: M1BrandInput = { name: trimmedName };
    for (const { key } of LIST_FIELDS) {
      const parsed = parseList(lists[key] ?? "");
      if (parsed.length > 0) payload[key] = parsed;
    }
    setSaving(true);
    setError(null);
    try {
      if (initial) {
        await m1.updateBrand(initial.id, payload);
      } else {
        await m1.createBrand(payload);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={initial ? "Edit brand" : "Create a protected brand"}
        description={
          initial
            ? "Edits submit the full editable shape (name + the five DNA lists) to Sentinel DRP. Demo brands are read-only."
            : "Defines what to protect — the risk engine scores discovered entities against this DNA. Lists accept one entry per line, up to 20 each."
        }
      />
      <form onSubmit={submit} className="space-y-4 px-4 py-4 sm:px-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="brand-name" className="block text-[11px] font-medium uppercase tracking-widest text-faint">
              Name <span className="text-risk-medium">*</span>
            </label>
            <input
              id="brand-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Acme Corp"
              className={inputClass}
              maxLength={80}
              aria-required="true"
            />
          </div>
          {LIST_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`brand-${key}`} className="block text-[11px] font-medium uppercase tracking-widest text-faint">
                {label}
              </label>
              <textarea
                id={`brand-${key}`}
                value={lists[key] ?? ""}
                onChange={(event) => setLists((prev) => ({ ...prev, [key]: event.target.value }))}
                rows={2}
                placeholder={placeholder}
                spellCheck={false}
                className={`${inputClass} resize-y font-mono text-xs`}
              />
            </div>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-xs text-risk-medium">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : initial ? "Save changes" : "Create brand"}
          </Button>
          {onCancel ? (
            <Button variant="default" type="button" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
