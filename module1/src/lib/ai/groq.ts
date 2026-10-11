import "server-only";
/**
 * Groq explanation layer. Server-only: the API key is read from process.env and never
 * reaches the browser bundle. Called AFTER deterministic scoring; it can only explain.
 */
import type { AiAssessment } from "@/lib/engine/types";
import { SYSTEM_PROMPT, buildUserPrompt, type ExplanationInput } from "./prompt";
import { groundAssessment } from "./grounding";
import { fallbackAssessment } from "./fallback";

// GROQ_BASE_URL lets you route through a proxy/gateway (OpenAI-compatible); defaults to Groq.
const groqUrl = () => `${(process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, "")}/chat/completions`;
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const MAX_CONCURRENT = 3;

export function groqModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
}

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

/* ---- simple process-wide concurrency gate (rate-limit safety) ---- */
const g = globalThis as unknown as { __groqGate?: { active: number; queue: (() => void)[] } };
const gate = (g.__groqGate ??= { active: 0, queue: [] });
async function withGate<T>(fn: () => Promise<T>): Promise<T> {
  if (gate.active >= MAX_CONCURRENT) await new Promise<void>((r) => gate.queue.push(r));
  gate.active++;
  try {
    return await fn();
  } finally {
    gate.active--;
    gate.queue.shift()?.();
  }
}

class GroqError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public retryAfterMs = 0,
  ) {
    super(message);
  }
}

async function callGroq(input: ExplanationInput, model: string): Promise<unknown> {
  const body: Record<string, unknown> = {
    model,
    temperature: 0.2,
    max_completion_tokens: 1400,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  };
  if (model.startsWith("openai/gpt-oss")) {
    body.reasoning_effort = "low";
    body.include_reasoning = false;
  }

  const res = await fetch(groqUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 429) throw new GroqError("Groq rate limit reached", true, Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
    if (res.status >= 500) throw new GroqError(`Groq server error ${res.status}`, true, 1000);
    if (res.status === 401) throw new GroqError("Groq rejected the API key (401)", false);
    throw new GroqError(`Groq request failed (${res.status}) ${detail}`, false);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new GroqError("Groq returned an empty response", true, 500);
  try {
    return JSON.parse(content);
  } catch {
    // Some models wrap JSON in prose; extract the outermost object.
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new GroqError("Groq returned non-JSON output", true, 300);
  }
}

/**
 * Produces the AI assessment. Never throws — on any failure it returns the deterministic
 * fallback with the reason recorded, so a scan always completes.
 */
export async function explainWithGroq(input: ExplanationInput): Promise<AiAssessment> {
  if (!isGroqConfigured()) {
    return fallbackAssessment(input, "GROQ_API_KEY not set — showing deterministic template explanation");
  }
  const model = groqModel();
  let lastReason = "unknown error";
  let rejectedByGrounding = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await withGate(() => callGroq(input, model));
      const grounded = groundAssessment(raw, input, model);
      if (grounded.ok) return grounded.value;
      lastReason = grounded.reason;
      rejectedByGrounding = true;
      // Ungrounded output: one retry, then fall back.
      if (attempt >= 2) break;
    } catch (err) {
      const e = err as Error;
      rejectedByGrounding = false;
      const timedOut = e.name === "TimeoutError";
      lastReason = timedOut ? "Groq request timed out" : e.message;
      const retryable = timedOut || (e instanceof GroqError && e.retryable);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const wait = e instanceof GroqError && e.retryAfterMs ? e.retryAfterMs : 800 * attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
    }
  }
  console.warn(`[groq] falling back: ${lastReason}`);
  return fallbackAssessment(
    input,
    rejectedByGrounding
      ? `Groq output rejected by the grounding check (${lastReason}). Showing deterministic template explanation.`
      : `Groq unavailable — ${lastReason}. Showing deterministic template explanation.`,
  );
}
