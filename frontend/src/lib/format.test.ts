import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_LABEL,
  cx,
  EVIDENCE_TYPE_LABEL,
  formatDateTime,
  pct,
  shortId,
} from "./format";

describe("cx", () => {
  it("joins truthy parts and skips falsy", () => {
    expect(cx("a", false, undefined, null, "b")).toBe("a b");
    expect(cx()).toBe("");
  });
});

describe("formatDateTime", () => {
  it("formats a UTC ISO timestamp with the UTC suffix", () => {
    const result = formatDateTime("2026-10-08T14:30:00Z");
    expect(result).toContain("UTC");
    expect(result).not.toBe("—");
  });

  it("renders an em dash for missing values", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });

  it("passes through unparseable strings", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("shortId", () => {
  it("truncates long ids", () => {
    expect(shortId("6dc4fadf-baaa-5ef7-8d67-8c9fa58786bb")).toBe("6dc4fadf…");
  });

  it("leaves short ids alone", () => {
    expect(shortId("abc")).toBe("abc");
  });
});

describe("pct", () => {
  it("renders a ratio as a rounded percentage", () => {
    expect(pct(0.2)).toBe("20%");
    expect(pct(0.155)).toBe("16%");
  });
});

describe("label maps", () => {
  it("covers every classification", () => {
    expect(CLASSIFICATION_LABEL.BRAND_IMPERSONATION).toBe("Brand impersonation");
    expect(CLASSIFICATION_LABEL.UNKNOWN).toBe("Unclassified");
  });

  it("covers every evidence type used by Module 3", () => {
    expect(EVIDENCE_TYPE_LABEL.DOMAIN_INTEL).toBe("Domain intel");
    expect(EVIDENCE_TYPE_LABEL.RELATIONSHIP_LINK).toBe("Relationship link");
  });
});
