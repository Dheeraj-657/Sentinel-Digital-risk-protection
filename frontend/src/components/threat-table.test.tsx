// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThreatTable } from "./threat-table";
import { TenantProvider } from "../lib/tenant";
import type { ThreatSummary } from "../lib/types";

vi.mock("../lib/api", async () => (await import("../test/api-mock")).createApiMock());

afterEach(() => {
  cleanup();
});

const threat = (overrides: Partial<ThreatSummary>): ThreatSummary => ({
  threat_id: "t-1",
  entity_id: "entity-1",
  brand_id: "brand-1",
  risk_score: 42,
  risk_level: "LOW",
  classification: "UNKNOWN",
  status: "OPEN",
  analysis_timestamp: "2026-10-10T10:00:00Z",
  ...overrides,
});

describe("ThreatTable", () => {
  it("renders classifications through the canonical label map", () => {
    render(
      <TenantProvider>
        <MemoryRouter>
          <ThreatTable
            threats={[threat({}), threat({ threat_id: "t-2", classification: "BRAND_IMPERSONATION" })]}
          />
        </MemoryRouter>
      </TenantProvider>,
    );
    expect(screen.getByRole("link", { name: "Unclassified" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Brand impersonation" })).toBeTruthy();
    expect(screen.queryByText("unknown")).toBeNull();
    expect(screen.queryByText("brand impersonation")).toBeNull();
  });
});
