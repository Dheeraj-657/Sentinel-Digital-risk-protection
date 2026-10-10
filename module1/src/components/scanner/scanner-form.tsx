"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AtSign, Globe, Link2, Smartphone, Play, Check, Loader2 } from "lucide-react";
import type { EntityType } from "@/lib/engine/types";
import { ENTITY_META } from "@/lib/engine/constants";
import { DEMO_ENTITIES, type DemoEntity } from "@/lib/demo/dataset";
import { Button, ErrorState, Panel } from "@/components/ui/primitives";
import { cx } from "@/lib/ui";

export interface BrandOption {
  id: string;
  name: string;
  officialDomains: string[];
  officialHandles: string[];
  appDevelopers: string[];
  packagePrefixes: string[];
  isDemo: boolean;
}

const TYPES: { type: EntityType; icon: typeof Globe }[] = [
  { type: "PROFILE", icon: AtSign },
  { type: "WEBSITE", icon: Link2 },
  { type: "DOMAIN", icon: Globe },
  { type: "APP", icon: Smartphone },
];

const STAGES = [
  "Validating and normalizing input",
  "Querying intelligence sources",
  "Normalizing signals",
  "Calculating deterministic risk score",
  "Calculating confidence",
  "Selecting recommended actions",
  "Writing AI assessment from evidence",
];

type BrandMode = { kind: "saved"; id: string } | { kind: "custom" } | { kind: "none" };

interface CustomBrand {
  name: string;
  officialDomains: string;
  officialHandles: string;
  appDevelopers: string;
  packagePrefixes: string;
}

const EMPTY_CUSTOM: CustomBrand = { name: "", officialDomains: "", officialHandles: "", appDevelopers: "", packagePrefixes: "" };

export function ScannerForm({ brands }: { brands: BrandOption[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [type, setType] = useState<EntityType>((params.get("type") as EntityType) || "WEBSITE");
  const [input, setInput] = useState(params.get("input") ?? "");
  const [claimedDeveloper, setClaimedDeveloper] = useState("");
  const [brandMode, setBrandMode] = useState<BrandMode>(brands[0] ? { kind: "saved", id: brands[0].id } : { kind: "none" });
  const [custom, setCustom] = useState<CustomBrand>(EMPTY_CUSTOM);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<{ title: string; body: string; field?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  function applyDemo(d: DemoEntity) {
    setType(d.entityType);
    setInput(d.input);
    setClaimedDeveloper(d.claimedDeveloper ?? "");
    const b = brands.find((x) => x.name === d.brand);
    setBrandMode(b ? { kind: "saved", id: b.id } : { kind: "none" });
    setError(null);
  }

  async function run(override?: { type: EntityType; input: string; brandMode: BrandMode; claimedDeveloper?: string }) {
    const t = override?.type ?? type;
    const i = (override?.input ?? input).trim();
    const bm = override?.brandMode ?? brandMode;
    const dev = override?.claimedDeveloper ?? claimedDeveloper;
    if (i.length < 3) {
      setError({ title: "Enter something to analyse", body: ENTITY_META[t].help, field: "input" });
      inputRef.current?.focus();
      return;
    }
    if (bm.kind === "custom" && custom.name.trim().length < 2) {
      setError({ title: "Name the brand to compare against", body: "Enter the protected brand or person's name, or choose “No brand comparison”.", field: "brand.name" });
      return;
    }

    setError(null);
    setRunning(true);
    setStage(0);
    // Indicative progress while the request runs; the real per-stage timings appear in the report.
    timer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 420);

    const payload: Record<string, unknown> = { entityType: t, input: i };
    if (dev.trim()) payload.claimedDeveloper = dev.trim();
    if (bm.kind === "saved") payload.brandId = bm.id;
    if (bm.kind === "custom") payload.brand = { ...custom, name: custom.name.trim() };

    let navigated = false;
    try {
      const res = await fetch("/api/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const e = j?.error;
        if (res.status === 429) {
          setError({ title: "Scan limit reached", body: `${e?.message ?? "Too many scans."} The limit protects the AI and intelligence providers from overload.` });
        } else if (res.status === 400) {
          setError({ title: "Check the input", body: e?.message ?? "The request was invalid.", field: e?.field });
        } else {
          setError({ title: "The analysis didn't complete", body: e?.message ?? `The server responded with ${res.status}. Try again.` });
        }
        return;
      }
      setStage(STAGES.length);
      navigated = true;
      router.push(`/scans/${j.id}`);
    } catch {
      setError({ title: "Couldn't reach the server", body: "Check that `npm run dev` is still running, then try again." });
    } finally {
      if (timer.current) clearInterval(timer.current);
      // On success keep the progress view up until the report page replaces it.
      if (!navigated) setRunning(false);
    }
  }

  const meta = ENTITY_META[type];
  const inputInvalid = error?.field === "input";

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="space-y-6"
        noValidate
      >
        <Panel title="What are you analysing?">
          <div role="radiogroup" aria-label="Entity type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TYPES.map(({ type: t, icon: Icon }) => (
              <button
                type="button"
                role="radio"
                aria-checked={type === t}
                key={t}
                disabled={running}
                onClick={() => {
                  setType(t);
                  setError(null);
                }}
                className={cx(
                  "flex items-center gap-2.5 rounded-md border px-3 py-3 text-left text-sm transition-colors",
                  type === t ? "border-action bg-action/10 font-semibold text-fg" : "border-line text-muted hover:border-faint hover:text-fg",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {ENTITY_META[t].label}
              </button>
            ))}
          </div>

          <label htmlFor="entity-input" className="mt-6 block text-sm font-medium">
            {type === "PROFILE" ? "Profile URL or handle" : type === "APP" ? "Package name or store URL" : type === "DOMAIN" ? "Domain" : "Website URL"}
          </label>
          <input
            id="entity-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={meta.placeholder}
            disabled={running}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputInvalid}
            aria-describedby="entity-help"
            className={cx(
              "mt-2 w-full rounded-md border bg-ink px-3.5 py-3 font-mono text-[15px] text-fg placeholder:text-faint focus:outline-none",
              inputInvalid ? "border-risk-critical" : "border-line focus:border-action",
            )}
          />
          <p id="entity-help" className="mt-1.5 text-xs text-faint">
            {meta.help}
          </p>

          {type === "APP" && (
            <>
              <label htmlFor="claimed-dev" className="mt-5 block text-sm font-medium">
                Listed developer <span className="font-normal text-faint">(optional)</span>
              </label>
              <input
                id="claimed-dev"
                value={claimedDeveloper}
                onChange={(e) => setClaimedDeveloper(e.target.value)}
                disabled={running}
                placeholder="As shown on the store listing"
                className="mt-2 w-full rounded-md border border-line bg-ink px-3.5 py-2.5 text-sm focus:border-action focus:outline-none"
              />
            </>
          )}
        </Panel>

        <Panel title="Compare against a protected brand" aside="Optional, but raises confidence">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Protected brand">
            {brands.map((b) => (
              <BrandChip key={b.id} active={brandMode.kind === "saved" && brandMode.id === b.id} onClick={() => setBrandMode({ kind: "saved", id: b.id })} disabled={running}>
                {b.name}
              </BrandChip>
            ))}
            <BrandChip active={brandMode.kind === "custom"} onClick={() => setBrandMode({ kind: "custom" })} disabled={running}>
              Another brand or person
            </BrandChip>
            <BrandChip active={brandMode.kind === "none"} onClick={() => setBrandMode({ kind: "none" })} disabled={running}>
              No brand comparison
            </BrandChip>
          </div>

          {brandMode.kind === "saved" &&
            (() => {
              const b = brands.find((x) => x.id === brandMode.id)!;
              return (
                <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                  <Ref label="Official domains" values={b.officialDomains} />
                  <Ref label="Official handles" values={b.officialHandles.map((h) => `@${h}`)} />
                  <Ref label="App developers" values={b.appDevelopers} />
                  <Ref label="Package namespace" values={b.packagePrefixes} />
                </dl>
              );
            })()}

          {brandMode.kind === "custom" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Brand or person name" value={custom.name} onChange={(v) => setCustom({ ...custom, name: v })} invalid={error?.field === "brand.name"} placeholder="Acme Bank" />
              <Field label="Official websites" value={custom.officialDomains} onChange={(v) => setCustom({ ...custom, officialDomains: v })} placeholder="acmebank.com, acme.bank" />
              <Field label="Official social handles" value={custom.officialHandles} onChange={(v) => setCustom({ ...custom, officialHandles: v })} placeholder="acmebank, acmebanksupport" />
              <Field label="Official app developers" value={custom.appDevelopers} onChange={(v) => setCustom({ ...custom, appDevelopers: v })} placeholder="Acme Bank plc" />
              <Field label="App package namespace" value={custom.packagePrefixes} onChange={(v) => setCustom({ ...custom, packagePrefixes: v })} placeholder="com.acmebank" />
              <p className="self-end text-xs text-faint">Separate multiple values with commas. Save brands you reuse on the Protected brands page.</p>
            </div>
          )}
        </Panel>

        {error && <ErrorState title={error.title} body={error.body} />}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={running} className="px-6 py-2.5 text-[15px]">
            {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {running ? "Analysing…" : "Run analysis"}
          </Button>
          {!running && <p className="text-sm text-faint">Results are saved to scan history.</p>}
        </div>

        {running && (
          <Panel title="Analysis in progress">
            <ol className="space-y-2" aria-live="polite">
              {STAGES.map((s, i) => (
                <li key={s} className={cx("flex items-center gap-2.5 text-sm", i < stage ? "text-muted" : i === stage ? "text-fg" : "text-faint")}>
                  {i < stage ? (
                    <Check className="size-4 text-risk-verylow" aria-hidden />
                  ) : i === stage ? (
                    <span className="pulse-dot mx-1 size-2 rounded-full bg-action" aria-hidden />
                  ) : (
                    <span className="mx-1 size-2 rounded-full bg-line" aria-hidden />
                  )}
                  {s}
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </form>

      <aside>
        <Panel title="Sample entities" aside="Fill or run">
          <p className="mb-4 text-sm text-muted">Realistic cases backed by the demo dataset, including legitimate controls that should score very low.</p>
          <ul className="space-y-1">
            {DEMO_ENTITIES.map((d) => (
              <li key={d.input} className="group flex items-start gap-2 rounded-md p-2 hover:bg-raised">
                <button type="button" disabled={running} onClick={() => applyDemo(d)} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-medium">{d.label}</span>
                  <span className="block truncate font-mono text-xs text-muted">{d.input}</span>
                  <span className="mt-0.5 block text-xs text-faint">{d.scenario}</span>
                </button>
                <button
                  type="button"
                  disabled={running}
                  aria-label={`Run analysis on ${d.input}`}
                  title="Run now"
                  onClick={() => {
                    applyDemo(d);
                    const b = brands.find((x) => x.name === d.brand);
                    run({ type: d.entityType, input: d.input, brandMode: b ? { kind: "saved", id: b.id } : { kind: "none" }, claimedDeveloper: d.claimedDeveloper });
                  }}
                  className="mt-0.5 rounded-md border border-line p-1.5 text-muted hover:border-action hover:text-fg"
                >
                  <Play className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </div>
  );
}

function BrandChip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "rounded-full border px-3 py-1.5 text-sm transition-colors",
        active ? "border-action bg-action/10 font-semibold text-fg" : "border-line text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function Ref({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd className="truncate font-mono text-[13px] text-muted">{values.length ? values.join(", ") : "none"}</dd>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, invalid }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean }) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid}
        className={cx("mt-1.5 w-full rounded-md border bg-ink px-3 py-2 text-sm focus:outline-none", invalid ? "border-risk-critical" : "border-line focus:border-action")}
      />
    </div>
  );
}
