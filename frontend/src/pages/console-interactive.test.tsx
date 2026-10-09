// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import Dashboard from "./Dashboard";
import { Threats } from "./Threats";
import { ThreatDetail } from "./ThreatDetail";
import { NewAnalysis } from "./NewAnalysis";
import { m1, m2, m3 } from "../lib/api";
import { DEFAULT_TENANT, TenantProvider } from "../lib/tenant";
import { ToastProvider } from "../components/toast";
import { brandUuidFromCuid } from "../lib/brand-bridge";
import type {
  AnalysisJob,
  M1Brand,
  M1Health,
  M1ScanSummary,
  M1Stats,
  M3EntityListItem,
  M3Evidence,
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

const health: M1Health = {
  status: "ok",
  database: "sqlite",
  intelMode: "demo",
  ai: { provider: "template", configured: false, model: "template" },
  providers: [],
};

const brand: M1Brand = {
  id: "brand-1",
  name: "Acme",
  officialDomains: ["acme.example"],
  officialHandles: [],
  appDevelopers: [],
  packagePrefixes: [],
  keywords: ["acme"],
  isDemo: false,
  scanCount: 2,
};

const scanSummary: M1ScanSummary = {
  id: "scan-1",
  entityType: "PROFILE",
  target: "@acme_help",
  displayName: "Acme Help",
  brandName: "Acme",
  riskScore: 78,
  riskLevel: "HIGH",
  confidenceScore: 64,
  aiSource: "HEURISTIC",
  signalCount: 4,
  createdAt: "2026-10-10T10:00:00Z",
};

const threat: ThreatSummary = {
  threat_id: "threat-1",
  entity_id: "ent-1",
  brand_id: "brand-uuid-1",
  risk_score: 82,
  risk_level: "CRITICAL",
  classification: "BRAND_IMPERSONATION",
  status: "OPEN",
  analysis_timestamp: "2026-10-10T10:00:00Z",
};

const threat2: ThreatSummary = {
  threat_id: "threat-2",
  entity_id: "ent-1",
  brand_id: "brand-uuid-1",
  risk_score: 71,
  risk_level: "HIGH",
  classification: "PHISHING",
  status: "CONFIRMED",
  analysis_timestamp: "2026-10-10T09:00:00Z",
};

const threatsList: ThreatListResponse = {
  items: [threat, threat2],
  total: 2,
  limit: 200,
  offset: 0,
};

const factor: RiskFactor = {
  factor_id: "f1",
  factor_type: "IDENTITY_SIMILARITY",
  score: 80,
  weight: 0.2,
  contribution: 16,
  confidence: 0.9,
  basis: "OBSERVED",
  evidence_ids: [],
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

const entity: M3EntityListItem = {
  entity_id: "ent-1",
  tenant_id: DEFAULT_TENANT,
  entity_type: "WEBSITE",
  display_name: "Fake Acme Support",
  identifiers: { domain: "fake-acme.example" },
  attributes: {},
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:00Z",
};

const evidence: M3Evidence[] = [
  {
    evidence_id: "ev-1",
    source_id: "src-1",
    entity_id: "ent-1",
    evidence_type: "TEXT_CONTENT",
    collected_at: "2026-10-10T10:00:00Z",
    text: "Official Acme support",
    image_hash: null,
    url: null,
    metadata: {},
  },
];

const job: AnalysisJob = {
  job_id: "job-1",
  status: "QUEUED",
  brand_id: "brand-uuid-1",
  entity_id: "ent-1",
  created_at: "2026-10-10T10:00:00Z",
  started_at: null,
  completed_at: null,
  error_code: null,
  error_message: null,
  result: null,
};

describe("Dashboard quick navigation", () => {
  it("links every KPI card, severity row and quick action to a filtered destination", async () => {
    const stats: M1Stats = {
      total: 12,
      levels: { VERY_LOW: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 },
      byType: [{ type: "PROFILE", count: 5, avgRisk: 60 }],
      avgRisk: 62.4,
      avgConfidence: 71.2,
      recentHigh: [scanSummary],
      recent: [],
      topSignals: [{ ruleId: "handle-lookalike", title: "Lookalike handle", count: 7 }],
    };
    vi.mocked(m1.getStats).mockResolvedValue(stats);
    vi.mocked(m1.listBrands).mockResolvedValue({ items: [brand] });
    vi.mocked(m1.health).mockResolvedValue(health);
    vi.mocked(m2.listThreats).mockResolvedValue(threatsList);
    vi.mocked(m3.listEntities).mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    renderWithProviders(<Dashboard />);

    expect(await screen.findByText("Recent high-risk scans")).toBeTruthy();
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/threats");
    expect(hrefs).toContain("/threats?status=OPEN");
    expect(hrefs).toContain("/threats?status=CONFIRMED");
    expect(hrefs).toContain("/threats?level=CRITICAL");
    expect(hrefs).toContain("/threats?level=HIGH");
    expect(hrefs).toContain("/entities");
    expect(hrefs).toContain("/scans");
    expect(hrefs).toContain("/analysis/new");
    expect(hrefs).toContain("/scan/new");
    expect(
      screen
        .getByRole("link", { name: "Filter threats by critical risk level" })
        .getAttribute("href"),
    ).toBe("/threats?level=CRITICAL");
  });
});

describe("Threats URL-driven filters", () => {
  it("reads filters from the URL and refetches when a filter is cleared", async () => {
    vi.mocked(m2.listThreats).mockResolvedValue(threatsList);
    renderWithProviders(
      <Threats />,
      ["/threats?status=OPEN&level=HIGH&q=impersonation"],
    );

    expect(await screen.findByText("Brand impersonation")).toBeTruthy();
    expect(m2.listThreats).toHaveBeenCalledWith(
      { status: "OPEN", risk_level: "HIGH", limit: 200 },
      DEFAULT_TENANT,
    );

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "" } });
    await waitFor(() =>
      expect(m2.listThreats).toHaveBeenLastCalledWith(
        { risk_level: "HIGH", limit: 200 },
        DEFAULT_TENANT,
      ),
    );
  });

  it("ignores unknown URL values and still applies sort from the URL", async () => {
    vi.mocked(m2.listThreats).mockResolvedValue(threatsList);
    renderWithProviders(<Threats />, ["/threats?status=BOGUS&level=NOPE&sort=recent"]);

    expect(await screen.findByText("Threat register")).toBeTruthy();
    expect(m2.listThreats).toHaveBeenCalledWith({ limit: 200 }, DEFAULT_TENANT);
    expect((screen.getByLabelText("Filter by status") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Sort threats") as HTMLSelectElement).value).toBe("recent");
  });
});

describe("ThreatDetail status confirmation", () => {
  function renderDetail() {
    vi.mocked(m2.getThreat).mockResolvedValue(detail);
    vi.mocked(m3.listEvidence).mockResolvedValue([]);
    vi.mocked(m3.listSources).mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    vi.mocked(m1.listBrands).mockResolvedValue({ items: [] });
    vi.mocked(m3.listEntities).mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    renderWithProviders(
      <Routes>
        <Route path="/threats/:threatId" element={<ThreatDetail />} />
      </Routes>,
      ["/threats/threat-1"],
    );
  }

  it("requires an explicit confirmation step, then confirms and toasts", async () => {
    vi.mocked(m2.updateThreatStatus).mockClear();
    vi.mocked(m2.updateThreatStatus).mockResolvedValue({ ...detail, status: "CONFIRMED" });
    renderDetail();
    expect(await screen.findAllByText("Brand impersonation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm threat" }));
    expect(screen.getByText("Mark this threat as confirmed?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, confirm" })).toBeTruthy();
    expect(m2.updateThreatStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, confirm" }));
    await waitFor(() =>
      expect(m2.updateThreatStatus).toHaveBeenCalledWith("threat-1", "CONFIRMED", DEFAULT_TENANT),
    );
    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("marked confirmed");
  });

  it("lets the analyst cancel a dismissal without calling the API", async () => {
    vi.mocked(m2.updateThreatStatus).mockClear();
    renderDetail();
    expect(await screen.findAllByText("Brand impersonation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText("Dismiss this threat?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Confirm threat" })).toBeTruthy();
    expect(m2.updateThreatStatus).not.toHaveBeenCalled();
  });

  it("surfaces a failure inline and as a toast", async () => {
    vi.mocked(m2.updateThreatStatus).mockClear();
    vi.mocked(m2.updateThreatStatus).mockRejectedValue(new Error("engine down"));
    renderDetail();
    expect(await screen.findAllByText("Brand impersonation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm threat" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, confirm" }));
    await waitFor(() => expect(m2.updateThreatStatus).toHaveBeenCalled());
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some((alert) => alert.textContent?.includes("engine down"))).toBe(true);
    });
  });
});

describe("NewAnalysis success feedback", () => {
  it("toasts the queued job id after submission", async () => {
    vi.mocked(m1.listBrands).mockResolvedValue({ items: [brand] });
    vi.mocked(m3.listEntities).mockResolvedValue({
      items: [entity],
      total: 1,
      limit: 200,
      offset: 0,
    });
    vi.mocked(m3.listEvidence).mockResolvedValue(evidence);
    vi.mocked(m2.createAnalysis).mockResolvedValue(job);
    renderWithProviders(<NewAnalysis />, ["/analysis/new"]);

    fireEvent.change(await screen.findByLabelText(/Protected brand/), {
      target: { value: "brand-1" },
    });
    fireEvent.change(await screen.findByLabelText(/Discovered entity/), {
      target: { value: "ent-1" },
    });
    await screen.findByText("Official Acme support");
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));

    await waitFor(() =>
      expect(m2.createAnalysis).toHaveBeenCalledWith(
        brandUuidFromCuid("brand-1"),
        "ent-1",
        DEFAULT_TENANT,
      ),
    );
    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("Analysis queued — job job-1");
  });
});
