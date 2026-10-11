import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { m1, m2, m3, m4 } from "../lib/api";
import { errorMessage, useApi } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import { findBrandForUuid } from "../lib/brand-bridge";
import { cx, RISK_LEVEL_LABEL, shortId } from "../lib/format";
import { AnswerBubble, type Message } from "../components/analyst-panel";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from "../components/ui";
import type { AnalystRequest, ThreatSummary } from "../lib/types";

type Mode = "ask" | "compare" | "campaign";

const MODES: { id: Mode; label: string; description: string }[] = [
  { id: "ask", label: "Ask about a report", description: "Why a verdict was reached, what evidence supports it, what to do next." },
  { id: "compare", label: "Compare two reports", description: "Any two risk-engine verdicts side by side: scores, drivers, shared identifiers." },
  {
    id: "campaign",
    label: "Summarize a potential campaign",
    description: "A seed verdict plus the verdicts the engine links to it by exact shared identifiers. Never a confirmed campaign.",
  },
];

const DEFAULT_QUESTION: Record<Mode, string> = {
  ask: "Why was this entity classified this way?",
  compare: "Compare these two reports.",
  campaign: "Summarize this potential campaign.",
};

/**
 * AI Security Analyst — standalone section. Same backend as the docked panel
 * (POST /api/v1/investigation/analyst); answers are grounded in stored records
 * and say whether they came from Groq or the deterministic template.
 */
export function Analyst() {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode = (MODES.find((m) => m.id === params.get("mode"))?.id ?? "ask") as Mode;

  const threats = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);
  const entities = useApi(() => m3.listEntities({ limit: 200 }, tenant), [tenant]);
  const brands = useApi(() => m1.listBrands(), []);

  const [primary, setPrimary] = useState(params.get("threat") ?? "");
  const [second, setSecond] = useState("");
  // Linked members are selected by default; the analyst can untick some.
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState(DEFAULT_QUESTION[mode]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Message | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const items = threats.data?.items ?? [];
  const nameOf = useMemo(() => new Map((entities.data?.items ?? []).map((e) => [e.entity_id, e.display_name])), [entities.data]);
  const label = (t: ThreatSummary) => {
    const brand = findBrandForUuid(brands.data?.items ?? [], t.brand_id)?.name ?? (brands.error ? `brand ${shortId(t.brand_id)}` : `unregistered ${shortId(t.brand_id)}`);
    return `${nameOf.get(t.entity_id) ?? `Entity ${shortId(t.entity_id)}`} vs ${brand} — ${t.risk_score} ${RISK_LEVEL_LABEL[t.risk_level]}`;
  };
  const sorted = useMemo(() => [...items].sort((a, b) => b.risk_score - a.risk_score), [items]);
  const byId = useMemo(() => new Map(items.map((t) => [t.threat_id, t])), [items]);

  // Campaign: propose the exact-match neighbours of the seed (backend relations only).
  const related = useApi(
    () => (mode === "campaign" && primary ? m2.getRelated(primary, tenant) : Promise.resolve(null)),
    [mode, primary, tenant],
  );
  const seedEntity = byId.get(primary)?.entity_id;
  const linked = useMemo(() => {
    const seen = new Set<string>();
    return (related.data?.items ?? []).filter((r) => r.entity_id !== seedEntity && !seen.has(r.threat_id) && seen.add(r.threat_id));
  }, [related.data, seedEntity]);
  const members = linked.map((r) => r.threat_id).filter((id) => !unchecked.has(id)).slice(0, 11);

  const setMode = (next: Mode) => {
    const p = new URLSearchParams(params);
    p.set("mode", next);
    setParams(p, { replace: true });
    setQuestion(DEFAULT_QUESTION[next]);
    setResult(null);
  };

  const ready =
    question.trim().length >= 2 &&
    !!primary &&
    (mode !== "compare" || (!!second && second !== primary)) &&
    (mode !== "campaign" || members.length > 0);

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || pending) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const body: AnalystRequest = {
      question: question.trim(),
      threat_id: primary,
      ...(mode === "compare" ? { compare_threat_id: second } : {}),
      ...(mode === "campaign" ? { cluster_threat_ids: [primary, ...members] } : {}),
    };
    setPending(true);
    setResult(null);
    try {
      const response = await m4.askAnalyst(body, tenant, controller.signal);
      if (!controller.signal.aborted) setResult({ id: 1, role: "assistant", text: response.answer, response });
    } catch (err) {
      if (!controller.signal.aborted) setResult({ id: 1, role: "assistant", text: "", error: errorMessage(err) });
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const select = (id: string, value: string, onChange: (v: string) => void, exclude?: string) => (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-line bg-ink/50 px-2 py-1.5 text-[13px] text-fg"
    >
      <option value="">Choose a report…</option>
      {sorted
        .filter((t) => t.threat_id !== exclude)
        .map((t) => (
          <option key={t.threat_id} value={t.threat_id}>
            {label(t)}
          </option>
        ))}
    </select>
  );

  return (
    <>
      <PageHeader
        title="AI Security Analyst"
        description="Questions about stored risk-engine verdicts, evidence and exact-match relations in this tenant. The analyst cites its sources, never changes a score, and never performs actions."
      />

      <div role="radiogroup" aria-label="Analyst task" className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cx(
              "rounded-lg border px-4 py-3 text-left transition",
              mode === m.id ? "border-action/60 bg-action/[0.06]" : "border-line-soft bg-panel hover:border-line",
            )}
          >
            <span className="block text-[13px] font-semibold text-fg">{m.label}</span>
            <span className="mt-0.5 block text-xs text-muted">{m.description}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader title={MODES.find((m) => m.id === mode)!.label} description="Pick the stored reports the answer may use." />
          {threats.loading ? (
            <div className="px-4 py-4 sm:px-5">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : threats.error ? (
            <ErrorState error={threats.error} onRetry={threats.reload} context="risk reports" />
          ) : items.length === 0 ? (
            <EmptyState title="No risk reports yet" description="Run a threat analysis first; the analyst only works from stored verdicts." />
          ) : (
            <form onSubmit={run} className="space-y-3 px-4 py-4 sm:px-5">
              <div>
                <label htmlFor="an-primary" className="mb-1 block text-xs text-muted">
                  {mode === "campaign" ? "Seed report" : mode === "compare" ? "First report" : "Report"}
                </label>
                {select("an-primary", primary, setPrimary)}
              </div>
              {mode === "compare" ? (
                <div>
                  <label htmlFor="an-second" className="mb-1 block text-xs text-muted">Second report</label>
                  {select("an-second", second, setSecond, primary)}
                </div>
              ) : null}
              {mode === "campaign" && primary ? (
                <fieldset className="rounded-md border border-line-soft px-3 py-2">
                  <legend className="px-1 text-xs text-muted">Linked by an exact shared identifier</legend>
                  {related.loading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : related.error ? (
                    <p className="text-xs text-risk-medium">Relations could not be loaded ({errorMessage(related.error)}).</p>
                  ) : linked.length === 0 ? (
                    <p className="text-xs text-muted">
                      {(related.data?.warnings.length ?? 0) > 0
                        ? `Relations could not be fully computed: ${related.data!.warnings[0]}`
                        : "The risk engine links no other entity to this report, so there is nothing to group."}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {linked.map((r) => (
                        <li key={r.threat_id}>
                          <label className="flex items-start gap-2 text-[13px] text-fg">
                            <input
                              type="checkbox"
                              className="mt-0.5 accent-[var(--color-action)]"
                              checked={members.includes(r.threat_id)}
                              onChange={(e) =>
                                setUnchecked((cur) => {
                                  const next = new Set(cur);
                                  if (e.target.checked) next.delete(r.threat_id);
                                  else next.add(r.threat_id);
                                  return next;
                                })
                              }
                            />
                            <span className="min-w-0">
                              {r.entity_display_name ?? `Entity ${shortId(r.entity_id)}`}
                              <span className="block font-mono text-[11px] text-muted">
                                {r.shared_attribute.key}: {r.shared_attribute.value}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </fieldset>
              ) : null}
              <div>
                <label htmlFor="an-question" className="mb-1 block text-xs text-muted">Question</label>
                <textarea
                  id="an-question"
                  rows={2}
                  maxLength={1000}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className="w-full resize-none rounded-md border border-line bg-ink/60 px-3 py-2 text-[13px] text-fg focus:border-ai/60 focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={!ready || pending}
                  className="rounded-md bg-action px-3 py-1.5 text-[13px] font-semibold text-on-action transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pending ? "Analyzing…" : "Ask the analyst"}
                </button>
                {primary && byId.get(primary) ? (
                  <Link to={`/investigate/${byId.get(primary)!.entity_id}?threat=${primary}`} className="text-xs text-action hover:text-fg">
                    Open the investigation
                  </Link>
                ) : null}
              </div>
            </form>
          )}
        </Card>

        <section aria-label="Analyst answer" aria-live="polite" aria-busy={pending} className="min-w-0">
          {pending ? (
            <Card>
              <p className="px-4 py-6 text-xs text-muted sm:px-5">Retrieving stored evidence and composing a grounded answer…</p>
            </Card>
          ) : result?.error ? (
            <Card>
              <div role="alert" className="px-4 py-4 text-[13px] sm:px-5">
                <p className="text-fg">The analyst could not answer.</p>
                <p className="mt-0.5 text-xs text-muted">{result.error}</p>
              </div>
            </Card>
          ) : result ? (
            <ol className="list-none">
              <AnswerBubble
                message={result}
                onCiteEvidence={(id) => {
                  const entityId = byId.get(primary)?.entity_id;
                  if (entityId) navigate(`/investigate/${entityId}?threat=${primary}&tab=evidence&ev=${id}`);
                }}
              />
            </ol>
          ) : (
            <Card>
              <EmptyState title="No question asked yet" description="Choose the reports, adjust the question if you like, and ask." />
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
