import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { cx } from "../lib/format";
import { useApi } from "../lib/hooks";
import { m1, m2, m3 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { GlobalSearch } from "./global-search";

function Mark() {
  // A graph of connected nodes — the product's own mark.
  return (
    <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
      <path
        d="M6 21.5 14 6l8 15.5"
        fill="none"
        stroke="var(--color-fg)"
        strokeOpacity="0.55"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9.6 15h8.8" stroke="var(--color-fg)" strokeOpacity="0.4" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="14" cy="6" r="2.6" fill="var(--color-action)" />
      <circle cx="6" cy="21.5" r="2.3" fill="var(--color-fg)" />
      <circle cx="22" cy="21.5" r="2.3" fill="var(--color-fg)" />
    </svg>
  );
}

type NavItem = { to: string; label: string; end?: boolean; icon: string };

/* Grouped by the investigation journey: watch → investigate → intelligence → records. */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      { to: "/", label: "Overview", end: true, icon: "M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-4H4zm10-11h6V4h-6z" },
      { to: "/graph", label: "Threat graph", icon: "M6 6h.01M18 6h.01M12 18h.01M7.5 7.2l3.6 9.3M16.5 7.2l-3.6 9.3M8 6h8" },
    ],
  },
  {
    label: "Investigate",
    items: [
      { to: "/investigate", label: "Investigations", icon: "M11 4a7 7 0 1 0 4.4 12.4L20 21M8 11h6M11 8v6" },
      { to: "/threats", label: "Threats", icon: "M12 3 3 19h18L12 3zm0 6v4m0 3h.01" },
      { to: "/entities", label: "Entities", icon: "M4 7h16M4 12h16M4 17h10" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/brands", label: "Brands", icon: "M12 3 4 6.5v5c0 4.6 3.4 8.4 8 9.5 4.6-1.1 8-4.9 8-9.5v-5L12 3z" },
      { to: "/discovery", label: "Discovery", icon: "M3 12h3m12 0h3M12 3v3m0 12v3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" },
      { to: "/sources", label: "Sources", icon: "M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z" },
    ],
  },
  {
    label: "Records",
    items: [
      { to: "/scans", label: "Scans", icon: "M4 6V4h4M20 6V4h-4M4 18v2h4M20 18v2h-4M4 12h16" },
      { to: "/analysis/history", label: "History", icon: "M12 7v5l3 2M4 12a8 8 0 1 0 2.3-5.6M4 4v3h3" },
    ],
  },
];

function isActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/investigate") return pathname.startsWith("/investigate");
  if (item.to === "/discovery") return pathname.startsWith("/discovery");
  if (item.to === "/scans") return pathname.startsWith("/scans") || pathname.startsWith("/scan/");
  return pathname.startsWith(item.to);
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  return (
    <nav aria-label="Primary" className="space-y-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-[11px] font-medium text-faint">{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item, location.pathname);
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={cx(
                      "relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition",
                      active
                        ? "bg-white/[0.07] text-fg before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-action"
                        : "text-muted hover:bg-white/[0.04] hover:text-fg",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <NavIcon d={item.icon} />
                    {item.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
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
    <ul className="space-y-1.5" aria-label="Service status">
      {rows.map(({ label, state }) => (
        <li key={label} className="flex items-center justify-between gap-2 text-xs">
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
        </li>
      ))}
    </ul>
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
      <label htmlFor="tenant-input" className="block text-xs font-medium text-muted">
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
        className="w-full rounded-md border border-line bg-ink/60 px-2 py-1.5 font-mono text-[11px] text-fg placeholder:text-faint focus:border-action/60 focus:outline-none"
        aria-describedby={error ? "tenant-error" : "tenant-help"}
      />
      {error ? (
        <p id="tenant-error" className="text-[11px] text-risk-medium">
          {error}
        </p>
      ) : (
        <p id="tenant-help" className="text-[11px] leading-relaxed text-faint">
          Sent as <code className="font-mono">X-Tenant-ID</code> to the risk engine and evidence store. Data is
          isolated per tenant.
        </p>
      )}
      <button
        type="button"
        onClick={save}
        className="w-full rounded-md border border-line bg-raised px-2 py-1 text-xs font-medium text-muted transition hover:border-action/60 hover:text-fg"
      >
        Switch tenant
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[236px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-action focus:px-3 focus:py-2 focus:text-on-action"
      >
        Skip to content
      </a>

      {/* Sidebar (desktop) / drawer (mobile) */}
      <aside
        id="primary-nav"
        className={cx(
          "glass-strong fixed inset-y-0 left-0 z-40 w-[236px] border-r border-line-soft px-3 py-5 transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-full flex-col">
          <Link to="/" className="mb-7 flex items-center gap-2.5 px-2">
            <Mark />
            <span className="leading-tight">
              <span className="font-display block text-[17px] font-bold">TRUSTGRAPH</span>
              <span className="block text-[11px] text-faint">Security operations</span>
            </span>
          </Link>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <NavLinks onNavigate={() => setNavOpen(false)} />
          </div>
          <div className="mt-4 rounded-lg border border-line-soft bg-white/[0.02] p-3">
            <ServiceStatus />
          </div>
        </div>
      </aside>
      {navOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <div className="min-w-0">
        <header className="glass-strong sticky top-0 z-20 border-b border-line-soft">
          <div className="flex items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-controls="primary-nav"
              aria-expanded={navOpen}
              className="rounded-md border border-line p-1.5 text-muted hover:text-fg lg:hidden"
            >
              <span className="sr-only">Open navigation</span>
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
                aria-controls="settings-panel"
                className="rounded-md border border-line bg-raised/70 px-2.5 py-1.5 text-xs font-medium text-muted transition hover:border-action/60 hover:text-fg"
              >
                {settingsOpen ? "Close settings" : "Settings"}
              </button>
              <Link
                to="/analysis/new"
                className="whitespace-nowrap rounded-md bg-action px-3 py-1.5 text-[13px] font-semibold text-on-action transition hover:bg-action-strong"
              >
                <span className="sm:hidden">Analyze</span>
                <span className="hidden sm:inline">New threat analysis</span>
              </Link>
            </div>
          </div>
          {settingsOpen ? (
            <div id="settings-panel" className="border-t border-line-soft px-4 py-4 sm:px-6 lg:px-8">
              <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
                <TenantControl />
                <div>
                  <p className="mb-2 text-xs font-medium text-muted">Connected modules</p>
                  <ServiceStatus />
                </div>
              </div>
            </div>
          ) : null}
        </header>
        <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
