import { useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { cx } from "../lib/format";
import { useApi } from "../lib/hooks";
import { m1, m2, m3 } from "../lib/api";
import { useTenant } from "../lib/tenant";

function Mark() {
  // A graph of connected nodes — the product's own mark.
  return (
    <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
      <path
        d="M6 21.5 14 6l8 15.5"
        fill="none"
        stroke="var(--color-action)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.6 15h8.8" stroke="var(--color-action)" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
      <circle cx="14" cy="6" r="2.4" fill="var(--color-risk-critical)" />
      <circle cx="6" cy="21.5" r="2.4" fill="var(--color-action)" />
      <circle cx="22" cy="21.5" r="2.4" fill="var(--color-action)" />
    </svg>
  );
}

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/threats", label: "Threats" },
  { to: "/scans", label: "Scans" },
  { to: "/entities", label: "Entities" },
  { to: "/brands", label: "Brands" },
  { to: "/sources", label: "Sources" },
  { to: "/analysis/history", label: "History" },
];

function NavLinks() {
  const location = useLocation();
  return (
    <nav aria-label="Primary" className="flex items-center gap-1 lg:flex-col lg:items-stretch lg:gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = item.end
          ? location.pathname === item.to
          : location.pathname.startsWith(item.to);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={cx(
              "rounded px-3 py-1.5 text-sm font-medium transition",
              active ? "bg-raised text-fg" : "text-muted hover:bg-raised/60 hover:text-fg",
            )}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function ServiceStatus() {
  const m2Ready = useApi(() => m2.ready(), []);
  const m3Ready = useApi(() => m3.health(), []);
  const m1Ready = useApi(() => m1.health(), []);

  const rows = [
    { label: "Risk engine", state: m2Ready },
    { label: "Evidence store", state: m3Ready },
    { label: "Brand service", state: m1Ready },
  ];

  return (
    <div className="space-y-1.5">
      {rows.map(({ label, state }) => (
        <p key={label} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">{label}</span>
          {state.loading ? (
            <span className="text-faint">checking…</span>
          ) : state.error ? (
            <span className="flex items-center gap-1.5 text-risk-critical">
              <span className="size-1.5 rounded-full bg-risk-critical" aria-hidden />
              down
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-risk-low">
              <span className="size-1.5 rounded-full bg-risk-low" aria-hidden />
              up
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

function TenantControl() {
  const { tenant, setTenant } = useTenant();
  const [draft, setDraft] = useState(tenant);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(tenant), [tenant]);

  const save = () => {
    const trimmed = draft.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      setError("Enter a valid UUID tenant ID.");
      return;
    }
    setError(null);
    setTenant(trimmed.toLowerCase());
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor="tenant-input" className="block text-[11px] font-medium uppercase tracking-widest text-faint">
        Tenant ID
      </label>
      <input
        id="tenant-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
        }}
        spellCheck={false}
        className="w-full rounded border border-line bg-ink px-2 py-1.5 font-mono text-[11px] text-fg placeholder:text-faint focus:border-action/60 focus:outline-none"
        aria-describedby={error ? "tenant-error" : undefined}
      />
      {error ? (
        <p id="tenant-error" className="text-[11px] text-risk-medium">
          {error}
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed text-faint">
          Sent as <code className="font-mono">X-Tenant-ID</code> to the risk engine and evidence
          store. Data is isolated per tenant.
        </p>
      )}
      <button
        type="button"
        onClick={save}
        className="w-full rounded border border-line bg-raised px-2 py-1 text-[11px] font-medium text-muted transition hover:border-action/60 hover:text-fg"
      >
        Switch tenant
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur lg:h-dvh lg:flex-col lg:items-stretch lg:border-r lg:border-b-0 lg:py-6">
        <Link to="/" className="flex items-center gap-2.5 lg:px-2 lg:mb-6">
          <Mark />
          <span className="leading-tight">
            <span className="block text-[17px] font-bold tracking-tight">TRUSTGRAPH</span>
            <span className="hidden text-xs text-muted lg:block">Threat intelligence console</span>
          </span>
        </Link>
        <div className="ml-auto overflow-x-auto lg:ml-0">
          <NavLinks />
        </div>
        <div className="mt-auto hidden w-full space-y-4 rounded-md border border-line-soft p-3 lg:block">
          <Link
            to="/analysis/new"
            className="block rounded border border-action/60 bg-action/15 px-3 py-2 text-center text-xs font-semibold text-action transition hover:bg-action/25"
          >
            Run analysis
          </Link>
          <TenantControl />
          <div className="border-t border-line-soft pt-3">
            <ServiceStatus />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          aria-controls="mobile-panel"
          className="rounded border border-line bg-raised px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:border-action/60 hover:text-fg lg:hidden"
        >
          {settingsOpen ? "Close settings" : "Settings"}
        </button>
      </aside>
      {settingsOpen ? (
        <div
          id="mobile-panel"
          className="sticky top-[3.25rem] z-10 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur lg:hidden"
        >
          <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
            <TenantControl />
            <ServiceStatus />
          </div>
        </div>
      ) : null}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <div className="mb-4 flex items-center justify-end lg:hidden">
          <Link
            to="/analysis/new"
            className="rounded border border-action/60 bg-action/15 px-3 py-1.5 text-xs font-semibold text-action"
          >
            Run analysis
          </Link>
        </div>
        {children}
      </main>
    </div>
  );
}
