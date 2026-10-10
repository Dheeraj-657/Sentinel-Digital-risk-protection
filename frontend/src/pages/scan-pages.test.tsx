// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ScanDetail } from "./ScanDetail";
import { ScanNew } from "./ScanNew";
import { Scans } from "./Scans";
import { m1 } from "../lib/api";
import type {
  M1RiskCategory,
  M1ScanCreated,
  M1ScanDetail,
  M1ScanListResponse,
} from "../lib/types";

vi.mock("../lib/api", async () => (await import("../test/api-mock")).createApiMock());

afterEach(() => {
  cleanup();
});

const report = {
  riskScore: 74,
  riskLevel: "HIGH" as const,
  confidenceScore: 62,
  baseScore: 60,
  riskBreakdown: {} as Record<M1RiskCategory, number>,
  categories: [
    {
      category: "impersonation" as const,
      label: "Impersonation",
      cap: 35,
      rawPoints: 30,
      mitigationPoints: 0,
      points: 30,
      percent: 86,
      signalCount: 3,
      capped: false,
    },
  ],
  scoreAdjustments: [],
  confidenceFactors: [],
  signals: [
    {
      id: "sig-1",
      ruleId: "handle-lookalike",
      category: "impersonation" as const,
      severity: "HIGH" as const,
      title: "Lookalike handle",
      description: "The handle mimics the official one.",
      evidence: "@acme_help vs @acme",
      impact: 12,
      provider: "heuristic",
      origin: "COMPUTED" as const,
      reliability: 1,
    },
  ],
  aiAssessment: {
    summary: "Summary text.",
    keyFindings: [],
    actionNotes: [],
    caveats: [],
    model: null,
    source: "FALLBACK" as const,
    notes: [],
  },
  recommendedActions: [
    {
      id: "act-1",
      action: "Report the profile",
      priority: "IMMEDIATE" as const,
      rationale: "High-confidence impersonation.",
      basedOn: ["sig-1"],
    },
  ],
  providerRuns: [
    {
      providerId: "heuristic",
      providerName: "Heuristics",
      kind: "internal",
      status: "ok",
      origin: "COMPUTED" as const,
      latencyMs: 12,
    },
  ],
  intelMode: "demo" as const,
  durationMs: 1200,
  timestamp: "2026-10-10T10:00:00Z",
  entity: {
    type: "PROFILE" as const,
    input: "@acme_help",
    target: "@acme_help",
    displayName: "Acme Help",
  },
  brand: null,
};

describe("Scans", () => {
  it("renders scan rows with risk level and links to the report", async () => {
    const list: M1ScanListResponse = {
      items: [
        {
          id: "scan-1",
          entityType: "PROFILE",
          target: "@acme_help",
          displayName: "Acme Help",
          brandName: "Acme",
          riskScore: 72,
          riskLevel: "HIGH",
          confidenceScore: 61,
          aiSource: "GROQ",
          signalCount: 5,
          createdAt: "2026-10-10T10:00:00Z",
        },
      ],
      nextCursor: null,
      total: 1,
    };
    vi.mocked(m1.listScans).mockResolvedValue(list);
    render(
      <MemoryRouter>
        <Scans />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Acme Help")).toBeTruthy();
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getByText("Groq LLM")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Acme Help/ });
    expect(link.getAttribute("href")).toBe("/scans/scan-1");
  });

  it("shows the empty state when no scans exist", async () => {
    vi.mocked(m1.listScans).mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    render(
      <MemoryRouter>
        <Scans />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No scans yet")).toBeTruthy();
  });

  it("passes search and filter values to the list call", async () => {
    vi.mocked(m1.listScans).mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    render(
      <MemoryRouter>
        <Scans />
      </MemoryRouter>,
    );
    await screen.findByText("No scans yet");
    fireEvent.change(screen.getByLabelText("Filter by entity type"), {
      target: { value: "PROFILE" },
    });
    fireEvent.change(screen.getByLabelText("Filter by risk level"), {
      target: { value: "HIGH" },
    });
    await waitFor(() =>
      expect(m1.listScans).toHaveBeenLastCalledWith({
        q: undefined,
        type: "PROFILE",
        level: "HIGH",
        limit: 25,
        cursor: undefined,
      }),
    );
  });
});

describe("ScanNew", () => {
  it("blocks submission when the input is too short", async () => {
    render(
      <MemoryRouter>
        <ScanNew />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/Input/), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Run scan" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("at least 3 characters");
    expect(m1.createScan).not.toHaveBeenCalled();
  });

  it("submits the scan and navigates to the report", async () => {
    const created: M1ScanCreated = { ...report, id: "scan-9" };
    vi.mocked(m1.createScan).mockResolvedValue(created);
    render(
      <MemoryRouter initialEntries={["/scan/new"]}>
        <Routes>
          <Route path="/scan/new" element={<ScanNew />} />
          <Route path="/scans/:scanId" element={<div data-testid="scan-route" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/Input/), {
      target: { value: "https://fake-acme.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run scan" }));
    await waitFor(() =>
      expect(m1.createScan).toHaveBeenCalledWith({
        entityType: "WEBSITE",
        input: "https://fake-acme.example",
      }),
    );
    expect(await screen.findByTestId("scan-route")).toBeTruthy();
  });

  it("surfaces a createScan failure without navigating", async () => {
    vi.mocked(m1.createScan).mockRejectedValue(new Error("engine unavailable"));
    render(
      <MemoryRouter initialEntries={["/scan/new"]}>
        <ScanNew />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/Input/), {
      target: { value: "@acme_help" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run scan" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("engine unavailable");
  });
});

describe("ScanDetail", () => {
  it("renders the report with score, signals, actions, and history", async () => {
    const detail: M1ScanDetail = {
      report,
      history: [
        {
          id: "scan-1",
          riskScore: 74,
          riskLevel: "HIGH",
          confidenceScore: 62,
          createdAt: "2026-10-09T10:00:00Z",
          aiSource: "FALLBACK",
        },
      ],
    };
    vi.mocked(m1.getScan).mockResolvedValue(detail);
    render(
      <MemoryRouter initialEntries={["/scans/scan-1"]}>
        <Routes>
          <Route path="/scans/:scanId" element={<ScanDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Lookalike handle")).toBeTruthy();
    expect(screen.getByText("Report the profile")).toBeTruthy();
    expect(screen.getByText("Summary text.")).toBeTruthy();
    expect(screen.getAllByText("Impersonation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
  });

  it("renders an error state when the scan cannot be loaded", async () => {
    vi.mocked(m1.getScan).mockRejectedValue(new Error("scan not found"));
    render(
      <MemoryRouter initialEntries={["/scans/missing"]}>
        <Routes>
          <Route path="/scans/:scanId" element={<ScanDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Could not load scan missing")).toBeTruthy();
  });
});
