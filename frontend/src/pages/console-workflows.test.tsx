// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout";
import Dashboard from "./Dashboard";
import { Brands } from "./Brands";
import { BrandDetail } from "./BrandDetail";
import { Entities } from "./Entities";
import { EntityDetail } from "./EntityDetail";
import { m1, m2, m3 } from "../lib/api";
import { DEFAULT_TENANT, TenantProvider } from "../lib/tenant";
import type {
  M1Brand,
  M1Health,
  M1ScanSummary,
  M1Stats,
  M3EntityListItem,
  ThreatListResponse,
} from "../lib/types";

vi.mock("../lib/api", async () => (await import("../test/api-mock")).createApiMock());

afterEach(() => {
  cleanup();
});

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

const noThreats: ThreatListResponse = { items: [], total: 0, limit: 200, offset: 0 };

describe("AppShell", () => {
  it("links scans, sources and history in the nav and exposes mobile settings", () => {
    render(
      <TenantProvider>
        <MemoryRouter>
          <AppShell>
            <p>content</p>
          </AppShell>
        </MemoryRouter>
      </TenantProvider>,
    );
    expect(screen.getByRole("link", { name: "Scans" }).getAttribute("href")).toBe("/scans");
    expect(screen.getByRole("link", { name: "Sources" }).getAttribute("href")).toBe("/sources");
    expect(screen.getByRole("link", { name: "History" }).getAttribute("href")).toBe(
      "/analysis/history",
    );

    const settings = screen.getByRole("button", { name: "Settings" });
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(settings);
    expect(
      screen.getByRole("button", { name: "Close settings" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByLabelText("Tenant ID")).toBeTruthy();
  });
});

describe("Dashboard", () => {
  it("renders Sentinel scan stats, recent high-risk scans and top signals", async () => {
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
    vi.mocked(m2.listThreats).mockResolvedValue(noThreats);
    vi.mocked(m3.listEntities).mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 });
    render(
      <TenantProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </TenantProvider>,
    );
    expect(await screen.findByText("Recent high-risk scans")).toBeTruthy();
    expect(screen.getByText(/avg risk 62/)).toBeTruthy();
    expect(screen.getByText(/avg confidence 71/)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Acme Help/ }).getAttribute("href")).toBe(
      "/scans/scan-1",
    );
    expect(screen.getByText("Lookalike handle")).toBeTruthy();
    expect(screen.getByText("7×")).toBeTruthy();
  });
});

describe("Brands", () => {
  it("validates short names and deletes a brand after confirmation", async () => {
    vi.mocked(m1.listBrands).mockResolvedValue({ items: [brand] });
    vi.mocked(m1.health).mockResolvedValue(health);
    render(
      <TenantProvider>
        <MemoryRouter>
          <Brands />
        </MemoryRouter>
      </TenantProvider>,
    );
    expect(await screen.findByText("Acme")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create brand" }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "a" } });
    const createButtons = screen.getAllByRole("button", { name: "Create brand" });
    fireEvent.click(createButtons[createButtons.length - 1]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("at least 2 characters");
    expect(m1.createBrand).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(m1.deleteBrand).toHaveBeenCalledWith("brand-1"));
  });
});

describe("BrandDetail", () => {
  it("shows brand DNA, brand-scoped scans and a prefilled edit form", async () => {
    vi.mocked(m1.getBrand).mockResolvedValue(brand);
    vi.mocked(m1.listScans).mockResolvedValue({
      items: [scanSummary],
      nextCursor: null,
      total: 1,
    });
    vi.mocked(m2.listThreats).mockResolvedValue(noThreats);
    render(
      <TenantProvider>
        <MemoryRouter initialEntries={["/brands/brand-1"]}>
          <Routes>
            <Route path="/brands/:brandId" element={<BrandDetail />} />
          </Routes>
        </MemoryRouter>
      </TenantProvider>,
    );
    expect(await screen.findByText("Brand DNA")).toBeTruthy();
    expect(screen.getByText("acme.example")).toBeTruthy();
    await waitFor(() =>
      expect(m1.listScans).toHaveBeenCalledWith({ brand: "brand-1", limit: 20 }),
    );
    expect(screen.getByRole("link", { name: /Acme Help/ }).getAttribute("href")).toBe(
      "/scans/scan-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit brand" }));
    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement;
    expect(nameInput.value).toBe("Acme");
    const domains = screen.getByLabelText("Official domains") as HTMLTextAreaElement;
    expect(domains.value).toBe("acme.example");
  });
});

describe("Entities", () => {
  it("passes search and type filters to the list call", async () => {
    vi.mocked(m3.listEntities).mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    render(
      <TenantProvider>
        <MemoryRouter>
          <Entities />
        </MemoryRouter>
      </TenantProvider>,
    );
    expect(await screen.findByText("No entities yet")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search entities"), { target: { value: "acme" } });
    await screen.findByText("No entities match the filters");
    fireEvent.change(screen.getByLabelText("Filter by entity type"), {
      target: { value: "WEBSITE" },
    });
    await waitFor(() =>
      expect(m3.listEntities).toHaveBeenLastCalledWith(
        { entity_type: "WEBSITE", q: "acme", limit: 200 },
        DEFAULT_TENANT,
      ),
    );
  });
});

describe("EntityDetail", () => {
  it("edits display name and identifiers through the PATCH endpoint", async () => {
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
    vi.mocked(m3.getEntity).mockResolvedValue(entity);
    vi.mocked(m3.listEvidence).mockResolvedValue([]);
    vi.mocked(m3.listSources).mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    vi.mocked(m2.listThreats).mockResolvedValue(noThreats);
    render(
      <TenantProvider>
        <MemoryRouter initialEntries={["/entities/ent-1"]}>
          <Routes>
            <Route path="/entities/:entityId" element={<EntityDetail />} />
          </Routes>
        </MemoryRouter>
      </TenantProvider>,
    );
    expect(await screen.findByText("Fake Acme Support")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit entity" }));
    const nameInput = screen.getByLabelText(/Display name/) as HTMLInputElement;
    expect(nameInput.value).toBe("Fake Acme Support");
    const identifiers = screen.getByLabelText("Identifiers") as HTMLTextAreaElement;
    expect(identifiers.value).toBe("domain: fake-acme.example");

    fireEvent.change(nameInput, { target: { value: "Fake Acme Support v2" } });
    fireEvent.change(identifiers, {
      target: { value: "domain: fake-acme.example\nhandle: @fake_acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(m3.updateEntity).toHaveBeenCalledWith(
        "ent-1",
        {
          display_name: "Fake Acme Support v2",
          identifiers: { domain: "fake-acme.example", handle: "@fake_acme" },
        },
        DEFAULT_TENANT,
      ),
    );
  });
});
