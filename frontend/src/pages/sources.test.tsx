// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sources } from "./Sources";
import { m3 } from "../lib/api";
import { TenantProvider } from "../lib/tenant";
import { DEFAULT_TENANT } from "../lib/tenant";

vi.mock("../lib/api", async () => (await import("../test/api-mock")).createApiMock());

afterEach(() => {
  cleanup();
});

function renderSources() {
  return render(
    <MemoryRouter>
      <TenantProvider>
        <Sources />
      </TenantProvider>
    </MemoryRouter>,
  );
}

describe("Sources", () => {
  it("renders registered sources with kind chips", async () => {
    vi.mocked(m3.listSources).mockResolvedValue({
      items: [
        {
          source_id: "src-1",
          name: "Acme Brand Watch feed",
          kind: "feed",
          created_at: "2026-10-10T10:00:00Z",
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });
    renderSources();
    expect(await screen.findByText("Acme Brand Watch feed")).toBeTruthy();
    expect(screen.getByText("feed")).toBeTruthy();
  });

  it("shows the empty state when no sources exist", async () => {
    vi.mocked(m3.listSources).mockResolvedValue({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    renderSources();
    expect(await screen.findByText("No sources yet")).toBeTruthy();
  });

  it("validates the create form before submitting", async () => {
    vi.mocked(m3.listSources).mockResolvedValue({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    renderSources();
    fireEvent.click(screen.getByRole("button", { name: "Register source" }));
    expect(await screen.findByText("A source name is required.")).toBeTruthy();
    expect(m3.createSource).not.toHaveBeenCalled();
  });

  it("requires a kind even when a name is given", async () => {
    vi.mocked(m3.listSources).mockResolvedValue({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    renderSources();
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Analyst review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register source" }));
    expect(await screen.findByText(/source kind is required/)).toBeTruthy();
    expect(m3.createSource).not.toHaveBeenCalled();
  });

  it("creates a source with the tenant and reloads the list", async () => {
    vi.mocked(m3.listSources).mockResolvedValue({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    vi.mocked(m3.createSource).mockResolvedValue({
      source_id: "src-2",
      name: "Analyst review",
      kind: "analyst",
      created_at: "2026-10-10T11:00:00Z",
    });
    renderSources();
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Analyst review" },
    });
    fireEvent.change(screen.getByLabelText(/Kind/), {
      target: { value: "analyst" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register source" }));
    await waitFor(() =>
      expect(m3.createSource).toHaveBeenCalledWith(
        { name: "Analyst review", kind: "analyst" },
        DEFAULT_TENANT,
      ),
    );
  });
});
