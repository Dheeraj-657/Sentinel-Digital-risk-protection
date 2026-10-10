import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { m4 } from "../lib/api";
import { errorMessage, useApi } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import { answerToHistory, parseAnswerLine } from "../lib/analyst";
import { cx, shortId } from "../lib/format";
import type { AnalystResponse, AnalystTurn, RiskLevel } from "../lib/types";

export interface CompareOption {
  threatId: string;
  label: string;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  response?: AnalystResponse;
  error?: string;
  /** For retry: the request this message answered or failed. */
  request?: AskOptions & { question: string };
}

interface AskOptions {
  compareThreatId?: string | null;
  clusterThreatIds?: string[];
}

interface Suggestion {
  question: string;
  options?: AskOptions;
  hint?: string;
}

function suggestions(
  level: RiskLevel | null,
  hasRelations: boolean,
  campaignThreatIds: string[],
  compareOptions: CompareOption[],
): Suggestion[] {
  const list: Suggestion[] = [
    { question: level ? `Why was this entity classified as ${level.toLowerCase()} risk?` : "Why might this entity be risky?" },
    { question: "What evidence supports the assessment?" },
    { question: hasRelations ? "Which entities are connected to this domain?" : "Is this entity connected to other threats?" },
    {
      question: "Summarize a potential campaign involving this entity.",
      options: campaignThreatIds.length > 1 ? { clusterThreatIds: campaignThreatIds } : undefined,
      hint:
        campaignThreatIds.length > 1
          ? `${campaignThreatIds.length} verdicts linked by exact shared identifiers`
          : "No linked verdicts yet; the analyst will explain what is missing",
    },
  ];
  if (compareOptions.length > 0) {
    list.push({
      question: "Compare these two reports.",
      options: { compareThreatId: compareOptions[0].threatId },
      hint: `With ${compareOptions[0].label}`,
    });
  }
  list.push({ question: "What should the security analyst investigate next?" });
  return list;
}

/**
 * AI Security Analyst, docked inside the investigation workspace.
 * Every answer comes from POST /api/v1/investigation/analyst (Module 4 backend),
 * which grounds it in stored verdicts/evidence and validates citations. The
 * panel shows which path produced each answer (Groq vs deterministic template)
 * and what data the answer was allowed to use.
 */
export function AnalystPanel({
  entityId,
  threatId,
  riskLevel,
  hasRelations,
  compareOptions,
  campaignThreatIds = [],
  onCiteEvidence,
}: {
  entityId: string;
  threatId: string | null;
  riskLevel: RiskLevel | null;
  hasRelations: boolean;
  compareOptions: CompareOption[];
  /** Subject verdict + verdicts the risk engine links to it by exact shared identifiers. */
  campaignThreatIds?: string[];
  onCiteEvidence: (evidenceId: string) => void;
}) {
  const { tenant } = useTenant();
  const status = useApi(() => m4.analystStatus(), []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [compareWith, setCompareWith] = useState("");
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  // A new subject is a new conversation; cancel anything in flight.
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setPending(false);
    setCompareWith("");
  }, [entityId, threatId, tenant]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Scroll the conversation log itself (never the page) to the newest message.
  useEffect(() => {
    const log = logRef.current;
    if (log && (messages.length > 0 || pending)) log.scrollTop = log.scrollHeight;
  }, [messages, pending]);

  const ask = async (question: string, options: AskOptions = {}) => {
    const { compareThreatId, clusterThreatIds } = options;
    const trimmed = question.trim();
    if (trimmed.length < 2 || pending) return; // no duplicate concurrent requests
    const history: AnalystTurn[] = messages
      .filter((m) => !m.error)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.role === "assistant" ? answerToHistory(m.text) : m.text }));

    const userMessage: Message = { id: nextId.current++, role: "user", text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setPending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await m4.askAnalyst(
        {
          question: trimmed,
          entity_id: entityId,
          threat_id: threatId,
          compare_threat_id: clusterThreatIds?.length ? null : compareThreatId || null,
          ...(clusterThreatIds?.length ? { cluster_threat_ids: clusterThreatIds } : {}),
          history,
        },
        tenant,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: "assistant", text: response.answer, response, request: { question: trimmed, ...options } },
      ]);
    } catch (err) {
      if (controller.signal.aborted) return;
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: "assistant", text: "", error: errorMessage(err), request: { question: trimmed, ...options } },
      ]);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const retry = (message: Message) => {
    if (!message.request) return;
    // Drop the failed answer and the question that produced it; ask() re-adds the question.
    setMessages((current) => {
      const index = current.findIndex((m) => m.id === message.id);
      return current.filter((_, k) => k !== index && !(k === index - 1 && current[k].role === "user"));
    });
    const { question, ...options } = message.request;
    void ask(question, options);
  };

  const llm = status.data;

  return (
    <section aria-label="AI Security Analyst" className="flex h-full min-h-[28rem] flex-col rounded-lg border border-line-soft bg-panel">
      <header className="border-b border-line-soft px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="size-2 rounded-full bg-ai" aria-hidden />
            AI Security Analyst
          </h2>
          <span
            className={cx(
              "rounded border px-1.5 py-0.5 text-[11px]",
              llm?.llm_configured ? "border-ai/40 text-ai" : "border-line text-muted",
            )}
            title={llm?.grounding}
          >
            {status.loading ? "Checking…" : status.error ? "Status unavailable" : llm?.llm_configured ? `Groq: ${llm.model}` : "Template mode"}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Answers use only this tenant's stored verdicts, evidence and exact-match relations. Citations link to the evidence.
          The analyst recommends; it never performs actions.
        </p>
      </header>

      <ol ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={pending}>
        {messages.length === 0 ? (
          <li className="list-none">
            <p className="mb-2 text-xs text-faint">Suggested questions</p>
            <div className="flex flex-col gap-1.5">
              {suggestions(riskLevel, hasRelations, campaignThreatIds, compareOptions).map((s) => (
                <button
                  key={s.question}
                  type="button"
                  onClick={() => {
                    if (s.options?.compareThreatId) setCompareWith(s.options.compareThreatId);
                    void ask(s.question, s.options);
                  }}
                  disabled={pending}
                  className="rounded-md border border-line-soft bg-white/[0.02] px-3 py-2 text-left text-[13px] text-fg transition hover:border-ai/50 disabled:opacity-50"
                >
                  {s.question}
                  {s.hint ? <span className="mt-0.5 block text-[11px] text-faint">{s.hint}</span> : null}
                </button>
              ))}
            </div>
          </li>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <li key={message.id} className="ml-8 list-none rounded-lg bg-white/[0.06] px-3 py-2 text-[13px] text-fg">
                {message.text}
              </li>
            ) : message.error ? (
              <li key={message.id} className="list-none rounded-lg border border-risk-critical/40 bg-risk-critical/5 px-3 py-2 text-[13px]" role="alert">
                <p className="text-fg">The analyst could not answer.</p>
                <p className="mt-0.5 text-xs text-muted">{message.error}</p>
                <button type="button" onClick={() => retry(message)} disabled={pending} className="mt-2 rounded-md border border-line px-2 py-1 text-xs text-fg hover:border-action/60 disabled:opacity-50">
                  Retry
                </button>
              </li>
            ) : (
              <AnswerBubble key={message.id} message={message} onCiteEvidence={onCiteEvidence} />
            ),
          )
        )}
        {pending ? (
          <li className="list-none text-xs text-muted">
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 animate-pulse rounded-full bg-ai" aria-hidden />
              Retrieving stored evidence and composing a grounded answer…
            </span>
          </li>
        ) : null}
      </ol>

      <form
        className="border-t border-line-soft px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft, { compareThreatId: compareWith || null });
        }}
      >
        {compareOptions.length > 0 ? (
          <div className="mb-2 flex items-center gap-2">
            <label htmlFor="analyst-compare" className="shrink-0 text-xs text-muted">
              Compare with
            </label>
            <select
              id="analyst-compare"
              value={compareWith}
              onChange={(event) => setCompareWith(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-ink/60 px-2 py-1 text-xs text-fg"
            >
              <option value="">No comparison</option>
              {compareOptions.map((option) => (
                <option key={option.threatId} value={option.threatId}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <label htmlFor="analyst-question" className="sr-only">
          Ask the analyst a question
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="analyst-question"
            rows={2}
            maxLength={1000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft, { compareThreatId: compareWith || null });
              }
            }}
            placeholder={compareWith ? "Ask how the two verdicts compare…" : "Ask about this entity's risk, evidence or connections…"}
            className="min-w-0 flex-1 resize-none rounded-md border border-line bg-ink/60 px-3 py-2 text-[13px] text-fg placeholder:text-faint focus:border-ai/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending || draft.trim().length < 2}
            className="rounded-md bg-action px-3 py-2 text-[13px] font-semibold text-on-action transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask
          </button>
        </div>
      </form>
    </section>
  );
}

function AnswerBubble({ message, onCiteEvidence }: { message: Message; onCiteEvidence: (id: string) => void }) {
  const response = message.response!;
  const groq = response.source === "GROQ";
  const [showContext, setShowContext] = useState(false);
  return (
    <li className="list-none rounded-lg border border-ai/25 bg-ai/[0.05] px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cx("rounded border px-1.5 py-px", groq ? "border-ai/40 text-ai" : "border-line text-muted")}>
          {groq ? "AI assessment" : "Evidence summary (template)"}
        </span>
        {groq && response.model ? <span className="text-faint">{response.model}</span> : null}
      </div>
      <div className="space-y-1 text-[13px] leading-relaxed text-fg">
        {message.text.split("\n").map((line, i) =>
          line.trim() === "" ? (
            <div key={i} className="h-1.5" aria-hidden />
          ) : (
            <p key={i} className={cx(line.startsWith("- ") && "pl-3 -indent-3")}>
              {parseAnswerLine(line).map((part, j) =>
                part.kind === "text" ? (
                  <span key={j}>{part.text}</span>
                ) : part.kind === "evidence" ? (
                  <button
                    key={j}
                    type="button"
                    onClick={() => onCiteEvidence(part.id)}
                    className="mx-0.5 inline-flex items-center rounded border border-evidence/40 bg-evidence/10 px-1 font-mono text-[10px] text-evidence align-middle hover:border-evidence"
                    title={`Show evidence ${part.id}`}
                  >
                    ev {shortId(part.id)}
                  </button>
                ) : (
                  <Link
                    key={j}
                    to={part.kind === "threat" ? `/threats/${part.id}` : `/investigate/${part.id}`}
                    className="mx-0.5 inline-flex items-center rounded border border-line bg-white/[0.04] px-1 font-mono text-[10px] text-muted align-middle hover:border-action/60 hover:text-fg"
                    title={`Open ${part.kind} ${part.id}`}
                  >
                    {part.kind} {shortId(part.id)}
                  </Link>
                ),
              )}
            </p>
          ),
        )}
      </div>

      {response.notes.length ? (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">{response.notes.join(" ")}</p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowContext((open) => !open)}
        aria-expanded={showContext}
        className="mt-2 text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline"
      >
        {showContext ? "Hide" : "Show"} what this answer used
      </button>
      {showContext ? (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-ink/50 px-2.5 py-2 text-[11px]">
          <dt className="text-faint">Evidence items</dt>
          <dd className="text-fg">{response.context.evidence_count} available, {response.citations.evidence_ids.length} cited</dd>
          <dt className="text-faint">Verdicts</dt>
          <dd className="text-fg">{response.context.threat_ids.length}</dd>
          <dt className="text-faint">Exact-match relations</dt>
          <dd className="text-fg">{response.context.related_count}</dd>
          <dt className="text-faint">Brand reference</dt>
          <dd className="text-fg">{response.context.brand_names.join(", ") || "Unavailable"}</dd>
          {response.limitations.length ? (
            <>
              <dt className="text-faint">Not available</dt>
              <dd className="text-fg">
                <ul className="list-disc space-y-0.5 pl-3.5">
                  {response.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </li>
  );
}
