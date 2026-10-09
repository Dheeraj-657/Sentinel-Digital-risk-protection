/**
 * Runs every demo entity through the full pipeline (template explainer, no network)
 * and asserts the expected risk bands. `npm run test:engine`
 */
import { analyzeEntity } from "../src/lib/engine/pipeline";
import { fallbackAssessment } from "../src/lib/ai/fallback";
import { groundAssessment } from "../src/lib/ai/grounding";
import { normalizeBrand, normalizeEntity, EntityValidationError } from "../src/lib/engine/entity";
import { DEMO_BRANDS, DEMO_ENTITIES } from "../src/lib/demo/dataset";
import type { RiskLevel } from "../src/lib/engine/types";

const EXPECT: Record<string, RiskLevel[]> = {
  "Credential-phishing page": ["CRITICAL"],
  "Homoglyph support domain": ["CRITICAL"],
  "Fake support account": ["HIGH", "CRITICAL"],
  "Crypto airdrop scam": ["CRITICAL"],
  "Malicious clone app": ["HIGH", "CRITICAL"],
  "Reward scam on free hosting": ["MEDIUM", "HIGH"],
  "Giveaway page": ["MEDIUM", "HIGH"],
  "Look-alike outlet store": ["MEDIUM", "HIGH"],
  "Official domain (control)": ["VERY_LOW"],
  "Official X account (control)": ["VERY_LOW"],
  "Official app (control)": ["VERY_LOW"],
  "Unknown domain, no brand": ["VERY_LOW", "LOW", "MEDIUM"],
};

let failures = 0;
const verbose = process.argv.includes("-v");

(async () => {
  for (const d of DEMO_ENTITIES) {
    const b = DEMO_BRANDS.find((x) => x.name === d.brand);
    const report = await analyzeEntity({
      entityType: d.entityType,
      input: d.input,
      brand: b ? normalizeBrand(b) : null,
      explain: async (x) => fallbackAssessment(x, "test"),
      mode: "demo",
    });
    const ok = EXPECT[d.label]?.includes(report.riskLevel);
    if (!ok) failures++;
    console.log(
      `${ok ? "✔" : "✘"} ${d.label.padEnd(30)} ${String(report.riskScore).padStart(3)} ${report.riskLevel.padEnd(9)} conf ${String(report.confidenceScore).padStart(2)}  ` +
        report.categories.filter((c) => c.points).map((c) => `${c.category}:${c.points}/${c.cap}`).join(" "),
    );
    if (verbose || !ok) {
      for (const s of report.signals) console.log(`     ${s.id} ${String(s.impact).padStart(3)} [${s.category}] ${s.title} — ${s.evidence}`);
      for (const a of report.scoreAdjustments) console.log(`     floor: ${a.reason}`);
      console.log(`     actions: ${report.recommendedActions.map((a) => a.action).join(" | ")}`);
    }
  }

  // Input validation
  const bad: [string, string][] = [["DOMAIN", "localhost"], ["DOMAIN", "not a domain"], ["APP", "hello"], ["PROFILE", "https://example.com/x"]];
  for (const [t, i] of bad) {
    try {
      normalizeEntity(t as never, i);
      console.log(`✘ validation accepted ${t} "${i}"`);
      failures++;
    } catch (e) {
      console.log(`✔ rejects ${t} "${i}" — ${(e as EntityValidationError).message}`);
    }
  }

  // Grounding guard
  const b = normalizeBrand(DEMO_BRANDS[0]);
  const r = await analyzeEntity({ entityType: "DOMAIN", input: "n0vapay-support.com", brand: b, explain: async (x) => fallbackAssessment(x, "t") });
  const input = {
    entity: r.entity, brandName: "NovaPay", riskScore: r.riskScore, riskLevel: r.riskLevel, confidenceScore: r.confidenceScore,
    categories: r.categories, adjustments: r.scoreAdjustments, confidenceFactors: r.confidenceFactors, signals: r.signals,
    actions: r.recommendedActions, providerGaps: [],
  };
  const cases: [string, unknown, boolean][] = [
    ["grounded output accepted", { summary: "A homoglyph look-alike of NovaPay already listed by threat feeds.", keyFindings: [{ text: "Look-alike name plus feed listing.", signalIds: ["S1", "S2"] }], actionNotes: [], caveats: [] }, true],
    ["invented number rejected", { summary: "Domain linked to 4,512 victims.", keyFindings: [{ text: "x evidence", signalIds: ["S1"] }] }, false],
    ["wrong level rejected", { summary: "This is a low risk domain overall.", keyFindings: [{ text: "x evidence", signalIds: ["S1"] }] }, false],
    ["uncited findings rejected", { summary: "Suspicious look-alike domain of NovaPay.", keyFindings: [{ text: "made up claim", signalIds: ["S99"] }] }, false],
  ];
  for (const [name, raw, expectOk] of cases) {
    const g = groundAssessment(raw, input, "test-model");
    const pass = g.ok === expectOk;
    if (!pass) failures++;
    console.log(`${pass ? "✔" : "✘"} grounding: ${name}${g.ok ? "" : ` (${g.reason})`}`);
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll engine checks passed");
  process.exit(failures ? 1 : 0);
})();
