/**
 * Deterministic string-similarity helpers used for brand/impersonation analysis.
 * No external calls — these always run on real input.
 */

/** Optimal-string-alignment distance (Levenshtein + adjacent transpositions). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** 0–1 normalized similarity based on edit distance. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

// Visually confusable characters → canonical latin letter.
const CONFUSABLES: Record<string, string> = {
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", $: "s", "!": "i", "|": "l",
  // Cyrillic / Greek look-alikes
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d",
  "ɡ": "g", "ο": "o", "α": "a", "ν": "v", "ρ": "p", "τ": "t", "κ": "k", "ı": "i",
};

/**
 * Reduces a string to a "visual skeleton": lowercase, confusables mapped,
 * common multi-letter tricks collapsed (rn→m, vv→w, cl→d), separators removed.
 */
export function skeleton(s: string): string {
  let out = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  out = Array.from(out)
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join("");
  out = out.replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d");
  return out.replace(/[^a-z0-9]/g, "").replace(/l/g, "i"); // treat l/i/1 as one glyph class
}

export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

/** Splits a label like "secure-novapay_login.help" into tokens. */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9À-￿]+/)
    .filter(Boolean);
}

export type BrandMatchKind = "EXACT" | "CONTAINS" | "HOMOGLYPH" | "TYPOSQUAT" | "SIMILAR" | "NONE";

export interface BrandMatch {
  kind: BrandMatchKind;
  /** 0–1 */
  score: number;
  candidate: string;
  against: string;
  detail: string;
}

/**
 * Compares a candidate identifier (domain label, handle, package segment, display name)
 * against a brand term and classifies the relationship.
 */
export function compareToBrand(candidateRaw: string, brandRaw: string): BrandMatch {
  const candidate = slug(candidateRaw);
  const brand = slug(brandRaw);
  const none: BrandMatch = { kind: "NONE", score: 0, candidate: candidateRaw, against: brandRaw, detail: "No meaningful similarity" };
  if (!candidate || !brand || brand.length < 3) return none;

  if (candidate === brand) {
    return { kind: "EXACT", score: 1, candidate: candidateRaw, against: brandRaw, detail: `"${candidateRaw}" is identical to "${brandRaw}"` };
  }

  const candSk = skeleton(candidateRaw);
  const brandSk = skeleton(brandRaw);

  if (candidate.includes(brand)) {
    return {
      kind: "CONTAINS",
      score: 0.9,
      candidate: candidateRaw,
      against: brandRaw,
      detail: `"${candidateRaw}" contains the brand name "${brandRaw}"`,
    };
  }

  if (candSk === brandSk || (candSk.includes(brandSk) && brandSk.length >= 4)) {
    return {
      kind: "HOMOGLYPH",
      score: 0.97,
      candidate: candidateRaw,
      against: brandRaw,
      detail: `"${candidateRaw}" renders like "${brandRaw}" using look-alike characters`,
    };
  }

  // Typosquat: compare the brand against the best-matching window of the candidate.
  let best = similarity(candidate, brand);
  let bestWindow = candidate;
  for (const t of tokens(candidateRaw)) {
    const s = similarity(slug(t), brand);
    if (s > best) {
      best = s;
      bestWindow = t;
    }
  }
  for (let len = brand.length - 1; len <= brand.length + 1; len++) {
    for (let i = 0; i + len <= candidate.length; i++) {
      const w = candidate.slice(i, i + len);
      const s = similarity(w, brand);
      if (s > best) {
        best = s;
        bestWindow = w;
      }
    }
  }
  const dist = levenshtein(slug(bestWindow), brand);
  if (dist <= 2 && best >= 0.75 && brand.length >= 4) {
    return {
      kind: "TYPOSQUAT",
      score: Math.round(best * 100) / 100,
      candidate: candidateRaw,
      against: brandRaw,
      detail: `"${bestWindow}" is ${dist} edit${dist === 1 ? "" : "s"} away from "${brand}" (${Math.round(best * 100)}% similar)`,
    };
  }
  if (best >= 0.7) {
    return {
      kind: "SIMILAR",
      score: Math.round(best * 100) / 100,
      candidate: candidateRaw,
      against: brandRaw,
      detail: `"${candidateRaw}" is ${Math.round(best * 100)}% similar to "${brandRaw}"`,
    };
  }
  return none;
}

/** Best match of a candidate against several brand terms. */
export function bestBrandMatch(candidate: string, brandTerms: string[]): BrandMatch {
  const rank: Record<BrandMatchKind, number> = { EXACT: 6, HOMOGLYPH: 5, CONTAINS: 4, TYPOSQUAT: 3, SIMILAR: 2, NONE: 0 };
  let best: BrandMatch = { kind: "NONE", score: 0, candidate, against: brandTerms[0] ?? "", detail: "No meaningful similarity" };
  for (const term of brandTerms) {
    const m = compareToBrand(candidate, term);
    if (rank[m.kind] > rank[best.kind] || (rank[m.kind] === rank[best.kind] && m.score > best.score)) best = m;
  }
  return best;
}

/** Finds which of the given phrases occur in text (case-insensitive). */
export function findPhrases(text: string, phrases: string[]): string[] {
  const t = text.toLowerCase();
  return phrases.filter((p) => t.includes(p.toLowerCase()));
}
