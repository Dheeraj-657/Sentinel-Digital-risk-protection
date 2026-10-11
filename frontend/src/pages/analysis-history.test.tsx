// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AnalysisHistory } from "./AnalysisHistory";
import { m2 } from "../lib/api";
import { TenantProvider } from "../lib/tenant";

vi.mock("../lib/api", async () => (await import("../test/api-mock")).createApiMock());

afterEach(() => {
  cleanup();
});

function renderHistory() {
  return render(
    <MemoryRouter>
      <TenantProvider>
        <AnalysisHistory />
      </TenantProvider>
    </MemoryRouter>,
  );
}

describe("AnalysisHistory", () => {
  it("renders jobs with status chips, error codes, and threat links", async () => {
    vi.mocked(m2.listJobs).mockResolvedValue({
      items: [
        {
          job_id: "11111111-1111-1111-1111-111111111111",
          status: "COMPLETED",
          brand_id: "bbbbbbbb-0000-0000-0000-000000000000",
          entity_id: "eeeeeeee-0000-0000-0000-000000000000",
          created_at: "2026-10-10T09:00:00Z",
          completed_at: "2026-10-10T09:01:00Z",
          threat_id: "22222222-2222-2222-2222-222222222222",
        },
        {
          job_id: "33333333-3333-3333-3333-333333333333",
          status: "FAILED",
          brand_id: "bbbbbbbb-0000-0000-0000-000000000000",
          entity_id: "eeeeeeee-0000-0000-0000-000000000000",
          created_at: "2026-10-10T08:00:00Z",
          error_code: "EVIDENCE_NOT_FOUND",
        },
      ],
      total: 2,
      limit: 25,
      offset: 0,
    });
    renderHistory();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(await screen.findByText("EVIDENCE_NOT_FOUND")).toBeTruthy();
    const threatLink = screen.getByRole("link", { name: /22222222/ });
    expect(threatLink.getAttribute("href")).toBe("/threats/22222222-2222-2222-2222-222222222222");
    const jobLink = screen.getByRole("link", { name: /11111111/ });
    expect(jobLink.getAttribute("href")).toBe("/analysis/11111111-1111-1111-1111-111111111111");
  });

  it("shows the empty state when the tenant has no jobs", async () => {
    vi.mocked(m2.listJobs).mockResolvedValue({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    renderHistory();
    expect(await screen.findByText("No jobs yet")).toBeTruthy();
  });

  it("filters jobs by status and resets pagination", async () => {
    vi.mocked(m2.listJobs).mockResolvedValue({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    renderHistory();
    await screen.findByText("No jobs yet");
    fireEvent.change(screen.getByLabelText("Filter by job status"), {
      target: { value: "FAILED" },
    });
    await waitFor(() =>
      expect(m2.listJobs).toHaveBeenLastCalledWith(
        { status: "FAILED", limit: 25, offset: 0 },
        expect.any(String),
      ),
    );
  });
});
