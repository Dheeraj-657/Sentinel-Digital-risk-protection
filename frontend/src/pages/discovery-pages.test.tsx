// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { BrandDetail } from "./BrandDetail";
import { DiscoveryJob } from "./DiscoveryJob";
import { ThreatDetail } from "./ThreatDetail";
import { m1, m2, m3 } from "../lib/api";
import { DEFAULT_TENANT, TenantProvider } from "../lib/tenant";
import { ToastProvider } from "../components/toast";
import { brandUuidFromCuid } from "../lib/brand-bridge";
import type {
  DiscoveryJob as DiscoveryJobData,
  M1Brand,
  M3EntityListItem,
  RelatedThreatsResponse,
  RiskFactor,
  ThreatDetail as ThreatDetailType,
  ThreatListResponse,
  ThreatSummary,
} from "../lib/types";

vi.mock("../lib/api", async () => (await import("../test/api-mock")).createApiMock());

afterEach(() => {
  cleanup();
});

function renderWithProviders(ui: ReactNode, initialEntries: string[] = ["/"]) {
  return render(
    <TenantProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
      </ToastProvider>
    </TenantProvider>,
  );
}

const brand: M1Brand = {
  id: "brand-1",
  name: "Acme",
  officialDomains: ["acme.example"],
  officialHandles: [],
  appDevelopers: [],
  packagePrefixes: [],
  keywords: ["acme"],
  isDemo: false,
  scanCount: 0,
};

const derivedUuid = brandUuidFromCuid("brand-1");

const completedJob: DiscoveryJobData = {
  job_id: "disc-1",
  status: "COMPLETED",
  brand_id: derivedUuid,
  queries: [
    { provider: "crt.sh", term: "acme.example", basis: "official domain acme.example" },
  ],
  provider_outcomes: [
    {
      provider: "crt.sh",
      status: "COMPLETED",
      candidate_count: 1,
      warning: null,
      error: null,
      latency_ms: 840,
    },
    {
      provider: "search",
      status: "UNCONFIGURED",
      candidate_count: 0,
      warning:
        "No search API credentials configured (TRUSTGRAPH_SEARCH_API_KEY) — provider skipped and reported as unconfigured.",
      error: null,
      latency_ms: null,
    },
  ],
  candidates: [
    {
      providers: ["crt.sh"],
      kind: "DOMAIN",
      domain: "fake-acme.example",
      url: null,
      title: null,
      snippet: null,
      query_basis: "official domain acme.example",
      observed_at: "2026-10-10T10:00:00Z",
      discovery_fingerprint: "fp-1",
      entity_id: "ent-9",
      evidence_id: "ev-9",
      analysis_job_id: "job-9",
      analysis_status: "COMPLETED",
    },
  ],
  source_ids: { "crt.sh": "src-1" },
  duplicate_count: 1,
  warning_message: null,
  created_at: "2026-10-10T10:00:00Z",
  started_at: "2026-10-10T10:00:01Z",
  completed_at: "2026-10-10T10:00:03Z",
  error_code: null,
  error_message: null,
};

const failedJob: DiscoveryJobData = {
  ...completedJob,
  job_id: "disc-2",
  status: "FAILED",
  candidates: [],
  warning_message: null,
  error_code: "ALL_PROVIDERS_FAILED",
  error_message: "Every provider failed — no candidate could be observed.",
};

const related: RelatedThreatsResponse = {
  threat_id: "threat-1",
  items: [
    {
      threat_id: "threat-2",
      entity_id: "ent-2",
      entity_display_name: "Fake Acme Portal",
      relation_type: "SHARED_DOMAIN",
      basis: "EXACT_ATTRIBUTE_MATCH",
      shared_attribute: { key: "domain", value: "fake-acme.example" },
      evidence_ids: ["ev-1", "ev-2"],
      target_evidence_ids: ["ev-7"],
    },
  ],
  total: 1,
  warnings: ["1 candidate entity was skipped because it belongs to another tenant."],
};

const threat: ThreatSummary = {
  threat_id: "threat-1",
  entity_id: "ent-1",
  brand_id: derivedUuid,
  risk_score: 82,
  risk_level: "CRITICAL",
  classification: "BRAND_IMPERSONATION",
  status: "OPEN",
  analysis_timestamp: "2026-10-10T10:00:00Z",
};

const factor: RiskFactor = {
  factor_id: "f1",
  factor_type: "DOMAIN_SIGNALS",
  score: 80,
  weight: 0.15,
  contribution: 12,
  confidence: 0.9,
  basis: "OBSERVED",
  evidence_ids: ["ev-1"],
};

const detail: ThreatDetailType = {
  ...threat,
  tenant_id: DEFAULT_TENANT,
  confidence: 0.8,
  model_version: "1",
  risk_engine_version: "1.2",
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:05:00Z",
  risk_factors: [factor],
  evidence_references: [],
};

describe("BrandDetail discovery entry point", () => {
  function renderBrand() {
    vi.mocked(m1.getBrand).mockResolvedValue(brand);
    vi.mocked(m1.listScans).mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    vi.mocked(m2.listThreats).mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    } as ThreatListResponse);
    vi.mocked(m2.listDiscovery).mockResolvedValue({
      items: [
        {
          job_id: "disc-1",
          status: "COMPLETED",
          brand_id: derivedUuid,
          duplicate_count: 1,
          candidate_count: 1,
          created_at: "2026-10-10T10:00:00Z",
          completed_at: "2026-10-10T10:00:03Z",
          error_code: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    renderWithProviders(
      <Routes>
        <Route path="/brands/:brandId" element={<BrandDetail />} />
        <Route path="/discovery/:jobId" element={<div data-testid="discovery-route" />} />
      </Routes>,
      ["/brands/brand-1"],
    );
  }

  it("posts discovery for the derived brand uuid and navigates to the job page", async () => {
    vi.mocked(m2.createDiscovery).mockClear();
    vi.mocked(m2.createDiscovery).mockResolvedValue(completedJob);
    renderBrand();
    expect(await screen.findByText("Acme")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discover threats" }));
    await waitFor(() =>
      expect(m2.createDiscovery).toHaveBeenCalledWith(derivedUuid, DEFAULT_TENANT),
    );
    expect(await screen.findByTestId("discovery-route")).toBeTruthy();
  });

  it("lists this brand's discovery runs with status and links", async () => {
    renderBrand();
    expect(await screen.findByText("Discovery runs")).toBeTruthy();
    const link = await screen.findByRole("link", { name: /disc-1/ });
    expect(link.getAttribute("href")).toBe("/discovery/disc-1");
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("surfaces a discovery failure inline without navigating", async () => {
    vi.mocked(m2.createDiscovery).mockClear();
    vi.mocked(m2.createDiscovery).mockRejectedValue(new Error("engine unreachable"));
    renderBrand();
    expect(await screen.findByText("Acme")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discover threats" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("engine unreachable");
    expect(screen.queryByTestId("discovery-route")).toBeNull();
  });
});

describe("DiscoveryJob page", () => {
  it("renders provider coverage, warnings, and candidates for a completed job", async () => {
    vi.mocked(m2.getDiscovery).mockResolvedValue(completedJob);
    vi.mocked(m1.listBrands).mockResolvedValue({ items: [brand] });
    vi.mocked(m3.listEntities).mockResolvedValue({
      items: [] as M3EntityListItem[],
      total: 0,
      limit: 200,
      offset: 0,
    });
    renderWithProviders(<DiscoveryJob />, ["/discovery/disc-1"]);

    expect((await screen.findAllByText("crt.sh")).length).toBeGreaterThan(0);
    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(screen.getByText(/No search API credentials configured/)).toBeTruthy();
    expect(screen.getByText("fake-acme.example")).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0); // candidate + duplicate counts
    const entityLink = screen.getByRole("link", { name: /Entity & evidence/ });
    expect(entityLink.getAttribute("href")).toBe("/entities/ent-9");
    const analysisLink = screen.getByRole("link", { name: /Analysis \(COMPLETED\)/ });
    expect(analysisLink.getAttribute("href")).toBe("/analysis/job-9");
  });

  it("polls until the job completes, then stops", async () => {
    vi.mocked(m2.getDiscovery)
      .mockResolvedValueOnce({ ...completedJob, status: "RUNNING", completed_at: null })
      .mockResolvedValue(completedJob);
    vi.mocked(m1.listBrands).mockResolvedValue({ items: [] });
    vi.mocked(m3.listEntities).mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    renderWithProviders(<DiscoveryJob />, ["/discovery/disc-1"]);

    expect(await screen.findByText("Running")).toBeTruthy();
    await waitFor(
      () => {
        expect(vi.mocked(m2.getDiscovery).mock.calls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 4000 },
    );
    await screen.findByText("Provider coverage");
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("shows the error banner for a failed job", async () => {
    vi.mocked(m2.getDiscovery).mockResolvedValue(failedJob);
    vi.mocked(m1.listBrands).mockResolvedValue({ items: [] });
    vi.mocked(m3.listEntities).mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    renderWithProviders(<DiscoveryJob />, ["/discovery/disc-2"]);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ALL_PROVIDERS_FAILED");
    expect(alert.textContent).toContain("Every provider failed");
  });
});

describe("ThreatDetail related threats", () => {
  function renderThreat() {
    vi.mocked(m2.getThreat).mockResolvedValue(detail);
    vi.mocked(m3.listEvidence).mockResolvedValue([]);
    vi.mocked(m3.listSources).mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    vi.mocked(m1.listBrands).mockResolvedValue({ items: [] });
    vi.mocked(m3.listEntities).mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    renderWithProviders(
      <Routes>
        <Route path="/threats/:threatId" element={<ThreatDetail />} />
      </Routes>,
      ["/threats/threat-1"],
    );
  }

  it("renders evidence-backed relations with the exact shared attribute", async () => {
    vi.mocked(m2.getRelated).mockResolvedValue(related);
    renderThreat();
    expect(await screen.findByText("Related threats")).toBeTruthy();
    expect(await screen.findByText("Fake Acme Portal")).toBeTruthy();
    expect(screen.getByText("SHARED_DOMAIN")).toBeTruthy();
    expect(screen.getByText(/EXACT_ATTRIBUTE_MATCH/)).toBeTruthy();
    expect(screen.getByText("fake-acme.example")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Fake Acme Portal" });
    expect(link.getAttribute("href")).toBe("/threats/threat-2");
    expect(
      screen.getByRole("link", { name: /View shared entity & evidence/ }).getAttribute("href"),
    ).toBe("/entities/ent-2");
    expect(screen.getByText(/On related threat:/).textContent).toContain("1");
    expect(screen.getByText(/skipped because it belongs to another tenant/)).toBeTruthy();
  });

  it("shows the honest empty state when nothing shares an exact identifier", async () => {
    vi.mocked(m2.getRelated).mockResolvedValue({
      threat_id: "threat-1",
      items: [],
      total: 0,
      warnings: [],
    });
    renderThreat();
    expect(await screen.findByText("No evidence-backed relations")).toBeTruthy();
    expect(
      screen.getByText(/Similar-looking names are not counted as relations/),
    ).toBeTruthy();
  });

  it("keeps relations hidden when the lookup fails instead of guessing", async () => {
    vi.mocked(m2.getRelated).mockRejectedValue(new Error("relation service down"));
    renderThreat();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("relation service down");
    expect(screen.queryByText("No evidence-backed relations")).toBeNull();
  });
});
