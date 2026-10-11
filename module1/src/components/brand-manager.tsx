"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState, ErrorState, Panel } from "@/components/ui/primitives";

export interface BrandRow {
  id: string;
  name: string;
  officialDomains: string[];
  officialHandles: string[];
  appDevelopers: string[];
  packagePrefixes: string[];
  keywords: string[];
  isDemo: boolean;
  scanCount: number;
}

const FIELDS = [
  { key: "officialDomains", label: "Official websites", ph: "acmebank.com, acme.bank" },
  { key: "officialHandles", label: "Official social handles", ph: "acmebank, acmebanksupport" },
  { key: "appDevelopers", label: "Official app developers", ph: "Acme Bank plc" },
  { key: "packagePrefixes", label: "App package namespace", ph: "com.acmebank" },
  { key: "keywords", label: "Other names and products", ph: "acme pay, acmewallet" },
] as const;

export function BrandManager({ brands }: { brands: BrandRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({ name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if ((form.name ?? "").trim().length < 2) {
      setError("Enter the brand or person's name.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/brands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const j = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setError(j?.error?.message ?? "The brand couldn't be saved.");
      return;
    }
    setForm({ name: "" });
    router.refresh();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove ${name} from protected brands? Past scans keep their snapshot.`)) return;
    const res = await fetch(`/api/brands/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error?.message ?? "The brand couldn't be removed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        {brands.length === 0 && <EmptyState title="No protected brands yet" body="Add the brand or person you protect so scans can detect impersonation against its official assets." />}
        {brands.map((b) => (
          <Panel
            key={b.id}
            title={b.name}
            aside={
              <span className="flex items-center gap-3">
                {b.isDemo && <span className="text-xs text-risk-medium">Demo brand</span>}
                <span>
                  {b.scanCount} scan{b.scanCount === 1 ? "" : "s"}
                </span>
                {!b.isDemo && (
                  <button onClick={() => remove(b.id, b.name)} aria-label={`Remove ${b.name}`} className="rounded p-1 text-faint hover:text-risk-critical">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </span>
            }
          >
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {FIELDS.map((f) => {
                const v = b[f.key];
                return (
                  <div key={f.key}>
                    <dt className="text-xs text-faint">{f.label}</dt>
                    <dd className="mt-0.5 font-mono text-[13px] break-words text-muted">{v.length ? v.join(", ") : "none"}</dd>
                  </div>
                );
              })}
            </dl>
            <Link href={`/scan`} className="mt-4 inline-block text-sm text-action hover:underline">
              Analyse an entity against {b.name}
            </Link>
          </Panel>
        ))}
      </div>

      <form onSubmit={save} className="h-fit" noValidate>
        <Panel title="Add a protected brand">
          <div className="space-y-4">
            <div>
              <label htmlFor="b-name" className="block text-sm font-medium">
                Brand or person name
              </label>
              <input
                id="b-name"
                value={form.name ?? ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Bank"
                className="mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm focus:border-action focus:outline-none"
              />
            </div>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label htmlFor={`b-${f.key}`} className="block text-sm font-medium">
                  {f.label}
                </label>
                <input
                  id={`b-${f.key}`}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.ph}
                  className="mt-1.5 w-full rounded-md border border-line bg-ink px-3 py-2 text-sm focus:border-action focus:outline-none"
                />
              </div>
            ))}
            <p className="text-xs text-faint">Separate multiple values with commas. Official assets are what look-alikes are compared against.</p>
            {error && <ErrorState title="Not saved" body={error} />}
            <Button type="submit" disabled={saving}>
              <Plus className="size-4" aria-hidden />
              {saving ? "Saving…" : "Save brand"}
            </Button>
          </div>
        </Panel>
      </form>
    </div>
  );
}
