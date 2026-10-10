// @vitest-environment jsdom
/**
 * Module 4 — unified workspace, AI Security Analyst, threat graph, discovery
 * center and global search. All fixtures are SYNTHETIC; every page reads the
 * mocked API module, so these tests prove the UI shows backend values as-is
 * and calls the existing operations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { Investigation } from "./Investigation";
import { Investigations } from "./Investigations";
import { ThreatGraph } from "./ThreatGraph";
import { DiscoveryCenter } from "./DiscoveryCenter";
import { AppShell } from "../components/layout";
import { m1, m2, m3, m4 } from "../lib/api";
import { DEFAULT_TENANT, TenantProvider } from "../lib/tenant";
import { ToastProvider } from "../components/toast";
import { brandUuidFromCuid } from "../lib/brand-bridge";
import type {
  AnalystResponse,
  M1Brand,
  M3EntityListItem,
  M3Evidence,
  RelatedThreatsResponse,
  ThreatDetail,
  ThreatSummary,
} from "../lib/types";

vi.mock("../lib/api", async () => (await import("../test/api-mock")).createApiMock());

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderAt(path: string, routes: ReactNode) {
  return render(
    <TenantProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>{routes}</Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </TenantProvider>,
  );
}

const T = "2026-10-10T10:00:00Z";
const ENTITY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ENTITY_B = "aaaaaaaa-0000-4000-8000-000000000002";
const THREAT_A = "bbbbbbbb-0000-4000-8000-000000000001";
const THREAT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const EV_DOMAIN = "cccccccc-0000-4000-8000-000000000001";
const EV_TEXT = "cccccccc-0000-4000-8000-000000000002";

const brand: M1Brand = {
  id: "cuid-acme",
  name: "Acme",
  officialDomains: ["acme.example"],
  officialHandles: ["acme"],
  appDevelopers: ["Acme Inc."],
  packagePrefixes: ["com.acme"],
  keywords: [],
  isDemo: false,
  scanCount: 0,
};
const BRAND_UUID = brandUuidFromCuid(brand.id);

const entityA: M3EntityListItem = {
  entity_id: ENTITY_A,
  tenant_id: DEFAULT_TENANT,
  entity_type: "SOCIAL_PROFILE",
  display_name: "Acme Help Desk (SYNTHETIC)",
  identifiers: { domain: "acme-help.example", handle: "acme_help" },
  attributes: {},
  created_at: T,
  updated_at: T,
};
const entityB: M3EntityListItem = {
  ...entityA,
  entity_id: ENTITY_B,
  entity_type: "MOBILE_APP",
  display_name: "Acme Help App (SYNTHETIC)",
  identifiers: { domain: "acme-help.example", package: "com.acme.help" },
  attributes: { origin: "discovery", discovery_job_id: "dddddddd-0000-4000-8000-000000000001" },
};

const summaryA: ThreatSummary = {
  threat_id: THREAT_A,
  entity_id: ENTITY_A,
  brand_id: BRAND_UUID,
  risk_score: 64,
  risk_level: "HIGH",
  classification: "PHISHING",
  status: "OPEN",
  analysis_timestamp: T,
};
const summaryB: ThreatSummary = { ...summaryA, threat_id: THREAT_B, entity_id: ENTITY_B, risk_score: 31, risk_level: "MEDIUM" };

const detailA: ThreatDetail = {
  ...summaryA,
  tenant_id: DEFAULT_TENANT,
  confidence: 0.71,
  model_version: "synthetic@1",
  risk_engine_version: "1.0.0",
  created_at: T,
  updated_at: T,
  risk_factors: [
    { factor_id: "f1", factor_type: "DOMAIN_SIGNALS", score: 90, weight: 0.15, contribution: 13.5, confidence: 1, basis: "OBSERVED", evidence_ids: [EV_DOMAIN] },
    { factor_id: "f2", factor_type: "TEXT_SIMILARITY", score: 60, weight: 0.15, contribution: 9, confidence: 0.6, basis: "DERIVED", evidence_ids: [EV_TEXT] },
  ],
  evidence_references: [
    { evidence_id: EV_DOMAIN, source_id: "s1", factor_types: ["DOMAIN_SIGNALS"] },
    { evidence_id: EV_TEXT, source_id: "s1", factor_types: ["TEXT_SIMILARITY"] },
  ],
};

const evidence: M3Evidence[] = [
  { evidence_id: EV_DOMAIN, source_id: "s1", entity_id: ENTITY_A, evidence_type: "DOMAIN_INTEL", collected_at: T, text: null, image_hash: null, url: "https://acme-help.example/login", metadata: { days_since_registration: 9 } },
  { evidence_id: EV_TEXT, source_id: "s1", entity_id: ENTITY_A, evidence_type: "TEXT_CONTENT", collected_at: T, text: "Verify your account now", image_hash: null, url: null, metadata: {} },
];

const related: RelatedThreatsResponse = {
  threat_id: THREAT_A,
  total: 1,
  warnings: [],
  items: [
    {
      threat_id: THREAT_B,
      entity_id: ENTITY_B,
      entity_display_name: "Acme Help App (SYNTHETIC)",
      relation_type: "SHARED_DOMAIN",
      basis: "EXACT_ATTRIBUTE_MATCH",
      shared_attribute: { key: "domain", value: "acme-help.example" },
      evidence_ids: [],
      target_evidence_ids: [EV_DOMAIN],
    },
  ],
};

function analystAnswer(overrides: Partial<AnalystResponse> = {}): AnalystResponse {
  return {
    answer: `Rated HIGH risk [threat:${THREAT_A}] because the domain was registered recently [ev:${EV_DOMAIN}].`,
    intent: "why",
    source: "TEMPLATE",
    model: null,
    citations: { evidence_ids: [EV_DOMAIN], threat_ids: [THREAT_A], entity_ids: [] },
    context: { threat_ids: [THREAT_A], entity_ids: [ENTITY_A], evidence_count: 2, related_count: 1, brand_names: ["Acme"], missing: [] },
    limitations: ["No reputation evidence is stored."],
    notes: ["No AI provider is configured; this answer is a deterministic summary of the stored records."],
    generated_at: T,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(m1.listBrands).mockResolvedValue({ items: [brand] });
  vi.mocked(m3.getEntity).mockResolvedValue(entityA);
  vi.mocked(m3.listEvidence).mockResolvedValue(evidence);
  vi.mocked(m3.listSources).mockResolvedValue({ items: [{ source_id: "s1", name: "synthetic-source", kind: "fixture", created_at: T }], total: 1, limit: 200, offset: 0 });
  vi.mocked(m3.listEntities).mockResolvedValue({ items: [entityA, entityB], total: 2, limit: 200, offset: 0 });
  vi.mocked(m2.listThreats).mockResolvedValue({ items: [summaryA, summaryB], total: 2, limit: 200, offset: 0 });
  vi.mocked(m2.getThreat).mockResolvedValue(detailA);
  vi.mocked(m2.getRelated).mockResolvedValue(related);
  vi.mocked(m2.listJobs).mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
  vi.mocked(m1.listScans).mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  vi.mocked(m4.analystStatus).mockResolvedValue({ llm_provider: "groq", llm_configured: false, model: "openai/gpt-oss-120b", grounding: "checked" });
});

const workspaceRoutes = (
  <>
    <Route path="/investigate/:entityId" element={<Investigation />} />
    <Route path="/investigate" element={<Investigations />} />
  </>
);

describe("Investigation workspace", () => {
  it("shows the risk engine's own score, brand reference and recommended actions", async () => {
    renderAt(`/investigate/${ENTITY_A}`, workspaceRoutes);
    expect(await screen.findByRole("heading", { name: "Acme Help Desk (SYNTHETIC)" })).toBeTruthy();
    expect(await screen.findByText("Output of the deterministic risk engine. Not recalculated in the console.")).toBeTruthy();
    // 64 appears as-is from the API (verdict selector and verdict card), never recomputed.
    expect((await screen.findAllByText("64")).length).toBeGreaterThan(0);
    expect(screen.getByText("71%")).toBeTruthy();
    expect(screen.getAllByText("Not an official asset").length).toBe(2);
    expect(screen.getByText(/Escalate to the brand's security response owner/)).toBeTruthy();
    expect(m2.getThreat).toHaveBeenCalledWith(THREAT_A, DEFAULT_TENANT);
  });

  it("lists connected entities from the related-threats endpoint", async () => {
    renderAt(`/investigate/${ENTITY_A}?tab=connections`, workspaceRoutes);
    const link = await screen.findByRole("link", { name: "Acme Help App (SYNTHETIC)" });
    expect(link.getAttribute("href")).toBe(`/investigate/${ENTITY_B}`);
    expect(screen.getByText(/not a\s+confirmed campaign/)).toBeTruthy();
  });

  it("asks the analyst with entity and verdict context and links citations to evidence", async () => {
    vi.mocked(m4.askAnalyst).mockResolvedValue(analystAnswer());
    renderAt(`/investigate/${ENTITY_A}`, workspaceRoutes);
    const question = await screen.findByRole("button", { name: "Why was this entity classified as high risk?" });
    fireEvent.click(question);
    expect(await screen.findByText("Evidence summary (template)")).toBeTruthy();
    expect(m4.askAnalyst).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Why was this entity classified as high risk?", entity_id: ENTITY_A, threat_id: THREAT_A }),
      DEFAULT_TENANT,
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^ev cccccccc/ }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("tab=evidence"));
    expect(document.getElementById(`ev-body-${EV_DOMAIN}`)).toBeTruthy();
  });

  it("labels a grounded AI answer and discloses what it used", async () => {
    vi.mocked(m4.askAnalyst).mockResolvedValue(analystAnswer({ source: "GROQ", model: "openai/gpt-oss-120b", notes: [] }));
    renderAt(`/investigate/${ENTITY_A}`, workspaceRoutes);
    fireEvent.click(await screen.findByRole("button", { name: "What evidence supports the assessment?" }));
    expect(await screen.findByText("AI assessment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show what this answer used" }));
    expect(screen.getByText("2 available, 1 cited")).toBeTruthy();
    expect(screen.getByText("No reputation evidence is stored.")).toBeTruthy();
  });

  it("shows analyst failures with a working retry", async () => {
    vi.mocked(m4.askAnalyst).mockRejectedValueOnce(new Error("Risk engine unreachable")).mockResolvedValueOnce(analystAnswer());
    renderAt(`/investigate/${ENTITY_A}`, workspaceRoutes);
    fireEvent.click(await screen.findByRole("button", { name: "Summarize the available evidence for this investigation." }));
    expect(await screen.findByText("Risk engine unreachable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Evidence summary (template)")).toBeTruthy();
    expect(m4.askAnalyst).toHaveBeenCalledTimes(2);
  });

  it("says plainly when an entity has no verdict", async () => {
    vi.mocked(m2.listThreats).mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    renderAt(`/investigate/${ENTITY_A}?tab=risk`, workspaceRoutes);
    expect(await screen.findByText("No risk breakdown yet")).toBeTruthy();
    expect(m2.getThreat).not.toHaveBeenCalled();
  });
});

describe("Investigations index", () => {
  it("ranks entities by their highest verdict", async () => {
    renderAt("/investigate", workspaceRoutes);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("Acme Help Desk");
    expect(rows[1].textContent).toContain("Acme Help App");
  });
});

describe("Threat graph", () => {
  it("draws backend relations and a labelled cluster, with a table alternative", async () => {
    vi.mocked(m2.getRelated).mockImplementation(async (id: string) =>
      id === THREAT_A
        ? related
        : { threat_id: THREAT_B, total: 1, warnings: [], items: [{ ...related.items[0], threat_id: THREAT_A, entity_id: ENTITY_A, entity_display_name: "Acme Help Desk (SYNTHETIC)" }] },
    );
    renderAt("/graph", <Route path="/graph" element={<ThreatGraph />} />);
    expect(await screen.findByText("2 entities")).toBeTruthy();
    expect(screen.getByText("domain: acme-help.example")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Entity Acme Help Desk \(SYNTHETIC\), highest verdict 64 High/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Table" }));
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getAllByText("EXACT_ATTRIBUTE_MATCH").length).toBe(2);
  });

  it("never invents links when the backend reports none", async () => {
    vi.mocked(m2.getRelated).mockResolvedValue({ threat_id: THREAT_A, total: 0, warnings: [], items: [] });
    renderAt("/graph", <Route path="/graph" element={<ThreatGraph />} />);
    expect(await screen.findByText("No two entities share a stored identifier in the current view.")).toBeTruthy();
  });

  it("reports relation lookups that failed instead of hiding them", async () => {
    vi.mocked(m2.getRelated).mockRejectedValue(new Error("down"));
    renderAt("/graph", <Route path="/graph" element={<ThreatGraph />} />);
    expect(await screen.findByText(/Relations for 2 verdicts could not be loaded/)).toBeTruthy();
  });
});

describe("Discovery center", () => {
  it("starts discovery through the existing API with the bridged brand id", async () => {
    vi.mocked(m2.listDiscovery).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    vi.mocked(m2.createDiscovery).mockResolvedValue({ job_id: "job-9" } as never);
    renderAt(
      "/discovery",
      <>
        <Route path="/discovery" element={<DiscoveryCenter />} />
        <Route path="/discovery/:jobId" element={<p>job page</p>} />
      </>,
    );
    fireEvent.change(await screen.findByLabelText("Protected brand"), { target: { value: brand.id } });
    fireEvent.click(screen.getByRole("button", { name: "Discover threats" }));
    expect(await screen.findByText("job page")).toBeTruthy();
    expect(m2.createDiscovery).toHaveBeenCalledWith(BRAND_UUID, DEFAULT_TENANT);
  });

  it("separates discovered from manually registered entities", async () => {
    vi.mocked(m2.listDiscovery).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    renderAt("/discovery?origin=discovery", <Route path="/discovery" element={<DiscoveryCenter />} />);
    expect(await screen.findByRole("link", { name: "Acme Help App (SYNTHETIC)" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Acme Help Desk (SYNTHETIC)" })).toBeNull();
  });
});

describe("Global search", () => {
  it("finds entities by identifier and opens the investigation with the keyboard", async () => {
    renderAt("/", <Route path="*" element={<AppShell><p>home</p></AppShell>} />);
    const box = screen.getByRole("combobox", { name: "Search entities, threats and brands" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "com.acme.help" } });
    expect(await screen.findByRole("option", { name: /Acme Help App/ })).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/investigate/${ENTITY_B}`));
  });
});
