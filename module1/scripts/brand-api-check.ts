/**
 * Checks the brand input pipeline shared by POST/PATCH /api/brands —
 * validation and canonical normalization. `npm run test:brands`
 */
import { brandInputSchema } from "../src/lib/engine/entity";
import { normalizeBrandInput } from "../src/lib/brand-input";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
};

// 1. Valid input normalizes every field to canonical form.
const parsed = brandInputSchema.safeParse({
  name: "  Acme  ",
  officialDomains: "https://WWW.Acme.com/pricing",
  officialHandles: "@Acme_Help",
  appDevelopers: "Acme Ltd",
  packagePrefixes: "Com.Acme",
  keywords: "Acme",
});
if (parsed.success) {
  const data = normalizeBrandInput(parsed.data);
  check("name trimmed", data.name === "Acme", JSON.stringify(data.name));
  check(
    "domains canonical",
    JSON.stringify(data.officialDomains) === '["acme.com"]',
    JSON.stringify(data.officialDomains),
  );
  check(
    "handles canonical",
    JSON.stringify(data.officialHandles) === '["acme_help"]',
    JSON.stringify(data.officialHandles),
  );
  check(
    "developers preserved",
    JSON.stringify(data.appDevelopers) === '["Acme Ltd"]',
    JSON.stringify(data.appDevelopers),
  );
  check(
    "prefixes lowercased",
    JSON.stringify(data.packagePrefixes) === '["com.acme"]',
    JSON.stringify(data.packagePrefixes),
  );
  check(
    "keywords lowercased",
    JSON.stringify(data.keywords) === '["acme"]',
    JSON.stringify(data.keywords),
  );
  check("no id leakage into prisma data", !("id" in data));
} else {
  check("valid input parses", false, JSON.stringify(parsed.error.issues));
}

// 2. Multi-line / comma-separated list fields split into entries.
const multi = brandInputSchema.safeParse({
  name: "Acme",
  officialDomains: "a.com\nb.com, c.com",
});
check(
  "multi-line list splits",
  multi.success && multi.data.officialDomains?.length === 3 && multi.data.officialDomains[2] === "c.com",
  multi.success ? JSON.stringify(multi.data.officialDomains) : "parse failed",
);

// 3. Validation rejects missing / too-short names.
check("missing name rejected", !brandInputSchema.safeParse({}).success);
check("1-char name rejected", !brandInputSchema.safeParse({ name: "x" }).success);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll brand-input checks passed");
process.exit(failures ? 1 : 0);
