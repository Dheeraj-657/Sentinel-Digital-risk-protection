/** Parsing helpers for AI Security Analyst answers (citation tokens). */

export type AnswerPart =
  | { kind: "text"; text: string }
  | { kind: "evidence" | "threat" | "entity"; id: string };

const TOKEN_RE =
  /\[(ev|threat|entity):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/g;

const KIND: Record<string, "evidence" | "threat" | "entity"> = {
  ev: "evidence",
  threat: "threat",
  entity: "entity",
};

/** Splits one line of answer text into text and citation parts. */
export function parseAnswerLine(line: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: line.slice(last, index) });
    parts.push({ kind: KIND[match[1]], id: match[2].toLowerCase() });
    last = index + match[0].length;
  }
  if (last < line.length) parts.push({ kind: "text", text: line.slice(last) });
  return parts;
}

/** Plain-text version of an answer for conversation history (tokens kept short). */
export function answerToHistory(answer: string): string {
  return answer.replace(TOKEN_RE, (_m, kind: string, id: string) => `[${kind}:${id}]`).slice(0, 1500);
}
