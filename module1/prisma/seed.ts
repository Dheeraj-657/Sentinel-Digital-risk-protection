/**
 * Seeds the demo protected brands and runs the sample entities through the real pipeline,
 * so the dashboard and history have content on first launch.
 *
 * Seed scans use the deterministic template explainer (no Groq calls, no API cost).
 * Scans you run from the UI use Groq when GROQ_API_KEY is set.
 *
 *   npm run db:seed            # brands + sample scans (skips scans if history exists)
 *   npm run db:seed -- --fresh # wipe scan history first
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { saveReport } from "../src/lib/scans";
import { analyzeEntity } from "../src/lib/engine/pipeline";
import { fallbackAssessment } from "../src/lib/ai/fallback";
import { normalizeBrand } from "../src/lib/engine/entity";
import { DEMO_BRANDS, DEMO_ENTITIES } from "../src/lib/demo/dataset";

async function main() {
  const fresh = process.argv.includes("--fresh");
  if (fresh) {
    await prisma.signal.deleteMany();
    await prisma.scan.deleteMany();
    console.log("Cleared scan history");
  }

  const brandIds: Record<string, string> = {};
  for (const b of DEMO_BRANDS) {
    const row = await prisma.brand.upsert({
      where: { name: b.name },
      update: { ...b, isDemo: true },
      create: { ...b, isDemo: true },
    });
    brandIds[b.name] = row.id;
  }
  console.log(`Protected brands: ${Object.keys(brandIds).join(", ")}`);

  if (!fresh && (await prisma.scan.count()) > 0) {
    console.log("Scan history already present — skipping sample scans (use --fresh to reset).");
    return;
  }

  for (const d of [...DEMO_ENTITIES].reverse()) {
    const b = DEMO_BRANDS.find((x) => x.name === d.brand);
    const brand = b ? { ...normalizeBrand(b), id: brandIds[b.name] } : null;
    const report = await analyzeEntity({
      entityType: d.entityType,
      input: d.input,
      claimedDeveloper: d.claimedDeveloper,
      brand,
      mode: "demo",
      explain: async (x) => fallbackAssessment(x, "Seeded sample scan with the deterministic template explanation. Re-scan it to get a Groq assessment."),
    });
    await saveReport(report, brand?.id ?? null);
    console.log(`  ${String(report.riskScore).padStart(3)}  ${report.riskLevel.padEnd(9)} ${d.input}`);
  }
  console.log(`Seeded ${DEMO_ENTITIES.length} sample scans`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
