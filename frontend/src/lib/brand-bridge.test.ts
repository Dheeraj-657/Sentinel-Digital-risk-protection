import { describe, expect, it } from "vitest";
import { v5 as uuidv5 } from "uuid";
import { brandUuidFromCuid, findBrandForUuid, SENTINEL_BRAND_NAMESPACE } from "./brand-bridge";
import type { M1Brand } from "./types";

const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// Verified against backend/app/integrations/module1/sentinel.py at the
// module-2-freeze tag: the derivation must match Module 2 exactly or threat
// rows stop resolving to brand names.
const KNOWN_CUID = "cmv19i3fz0000l4k68wq1z3bv";
const KNOWN_UUID = "6dc4fadf-baaa-5ef7-8d67-8c9fa58786bb";

describe("SENTINEL_BRAND_NAMESPACE", () => {
  it("is uuid5(NAMESPACE_DNS, 'trustgraph.module1.sentinel') — the backend derivation", () => {
    expect(SENTINEL_BRAND_NAMESPACE).toBe(uuidv5("trustgraph.module1.sentinel", NAMESPACE_DNS));
  });

  it("is a valid uuid5", () => {
    expect(SENTINEL_BRAND_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("brandUuidFromCuid", () => {
  it("reproduces the known Sentinel → Module 2 pair", () => {
    expect(brandUuidFromCuid(KNOWN_CUID)).toBe(KNOWN_UUID);
  });

  it("is stable for the same cuid", () => {
    expect(brandUuidFromCuid(KNOWN_CUID)).toBe(brandUuidFromCuid(KNOWN_CUID));
  });

  it("is a valid uuid5", () => {
    expect(brandUuidFromCuid("another-cuid")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("findBrandForUuid", () => {
  const brands: M1Brand[] = [
    {
      id: KNOWN_CUID,
      name: "NovaPay",
      officialDomains: ["novapay.example"],
      officialHandles: ["@novapay"],
      appDevelopers: [],
      packagePrefixes: [],
      keywords: ["novapay"],
      isDemo: true,
      scanCount: 3,
    },
    {
      id: "cmv19i3fz0000l4k68wq1z3bw",
      name: "Other",
      officialDomains: [],
      officialHandles: [],
      appDevelopers: [],
      packagePrefixes: [],
      keywords: [],
      isDemo: false,
      scanCount: 0,
    },
  ];

  it("finds the brand whose derived UUID matches", () => {
    expect(findBrandForUuid(brands, KNOWN_UUID)?.name).toBe("NovaPay");
  });

  it("matches case-insensitively", () => {
    expect(findBrandForUuid(brands, KNOWN_UUID.toUpperCase())?.name).toBe("NovaPay");
  });

  it("returns undefined for an unknown UUID", () => {
    expect(findBrandForUuid(brands, "00000000-0000-5000-8000-000000000000")).toBeUndefined();
  });
});
