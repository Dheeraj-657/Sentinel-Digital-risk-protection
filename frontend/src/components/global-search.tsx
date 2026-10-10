import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { m1, m2, m3 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { brandUuidFromCuid } from "../lib/brand-bridge";
import { CLASSIFICATION_LABEL, cx, ENTITY_TYPE_LABEL, RISK_LEVEL_CLASS, RISK_LEVEL_LABEL } from "../lib/format";
import type { M1Brand, M3EntityListItem, ThreatSummary } from "../lib/types";

interface Index {
  entities: M3EntityListItem[];
  threats: ThreatSummary[];
  brands: M1Brand[];
  failed: string[];
}

interface Result {
  key: string;
  group: "Entities" | "Threats" | "Brands";
  label: string;
  detail: string;
  to: string;
  risk?: ThreatSummary;
}

const MAX_PER_GROUP = 5;

function matches(haystack: Array<string | null | undefined>, needle: string): boolean {
  return haystack.some((value) => value?.toLowerCase().includes(needle));
}

/**
 * Global search over records the console already reads (Module 3 entities,
 * Module 2 threats, Module 1 brands). Loaded lazily on first focus and
 * matched client-side — it never queries a provider or the internet.
 */
export function GlobalSearch() {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadedFor = useRef<string | null>(null);

  const load = () => {
    if (loadedFor.current === tenant || loading) return;
    loadedFor.current = tenant;
    setLoading(true);
    Promise.allSettled([
      m3.listEntities({ limit: 200 }, tenant),
      m2.listThreats({ limit: 200 }, tenant),
      m1.listBrands(),
    ]).then(([entities, threats, brands]) => {
      const failed: string[] = [];
      if (entities.status === "rejected") failed.push("entities");
      if (threats.status === "rejected") failed.push("threats");
      if (brands.status === "rejected") failed.push("brands");
      setIndex({
        entities: entities.status === "fulfilled" ? entities.value?.items ?? [] : [],
        threats: threats.status === "fulfilled" ? threats.value?.items ?? [] : [],
        brands: brands.status === "fulfilled" ? brands.value?.items ?? [] : [],
        failed,
      });
      setLoading(false);
    });
  };

  // Tenant switch invalidates the index.
  useEffect(() => {
    loadedFor.current = null;
    setIndex(null);
  }, [tenant]);

  // "/" focuses search from anywhere (except while typing in a field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!index || needle.length < 2) return [];
    const entityName = new Map(index.entities.map((e) => [e.entity_id, e.display_name ?? e.entity_id]));
    const brandName = new Map(index.brands.map((b) => [brandUuidFromCuid(b.id), b.name]));

    const entities: Result[] = index.entities
      .filter((e) => matches([e.display_name, e.entity_id, ...Object.values(e.identifiers)], needle))
      .slice(0, MAX_PER_GROUP)
      .map((e) => ({
        key: `e-${e.entity_id}`,
        group: "Entities",
        label: e.display_name ?? e.entity_id,
        detail: `${ENTITY_TYPE_LABEL[e.entity_type] ?? e.entity_type}: ${Object.values(e.identifiers).slice(0, 2).join(", ") || "no identifiers"}`,
        to: `/investigate/${e.entity_id}`,
      }));

    const threats: Result[] = index.threats
      .filter((t) =>
        matches(
          [t.threat_id, CLASSIFICATION_LABEL[t.classification], entityName.get(t.entity_id), brandName.get(t.brand_id)],
          needle,
        ),
      )
      .slice(0, MAX_PER_GROUP)
      .map((t) => ({
        key: `t-${t.threat_id}`,
        group: "Threats",
        label: `${entityName.get(t.entity_id) ?? "Unknown entity"}`,
        detail: `${CLASSIFICATION_LABEL[t.classification]} vs ${brandName.get(t.brand_id) ?? "unknown brand"}`,
        to: `/threats/${t.threat_id}`,
        risk: t,
      }));

    const brands: Result[] = index.brands
      .filter((b) => matches([b.name, ...b.officialDomains, ...b.officialHandles, ...b.keywords], needle))
      .slice(0, MAX_PER_GROUP)
      .map((b) => ({
        key: `b-${b.id}`,
        group: "Brands",
        label: b.name,
        detail: b.officialDomains.join(", ") || "No official domains on file",
        to: `/brands/${b.id}`,
      }));

    return [...entities, ...threats, ...brands];
  }, [index, query]);

  useEffect(() => setActive(0), [query]);

  const go = (result: Result) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(result.to);
  };

  const showPanel = open && query.trim().length >= 2;

  return (
    <div className="relative w-full max-w-md">
      <label htmlFor="global-search" className="sr-only">
        Search entities, threats and brands
      </label>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M11 4a7 7 0 1 0 4.4 12.4L20 21" />
      </svg>
      <input
        ref={inputRef}
        id="global-search"
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-activedescendant={showPanel && results[active] ? `gs-${results[active].key}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder="Search entities, domains, threats, brands"
        onFocus={() => {
          setOpen(true);
          load();
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter" && results[active]) {
            event.preventDefault();
            go(results[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className="w-full rounded-md border border-line bg-ink/50 py-1.5 pl-8 pr-10 text-[13px] text-fg placeholder:text-faint focus:border-action/60 focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[10px] text-faint sm:block">
        /
      </kbd>

      {showPanel ? (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="glass-strong absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[60vh] overflow-y-auto rounded-lg border border-line p-1.5 shadow-2xl sm:right-auto sm:w-[30rem]"
        >
          {loading || !index ? (
            <p className="px-3 py-3 text-xs text-muted">Loading records…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted">No entities, threats or brands match “{query.trim()}”.</p>
          ) : (
            (["Entities", "Threats", "Brands"] as const).map((group) => {
              const items = results.filter((r) => r.group === group);
              if (!items.length) return null;
              return (
                <div key={group} className="py-1">
                  <p className="px-2.5 pb-1 text-[11px] font-medium text-faint">{group}</p>
                  {items.map((result) => {
                    const i = results.indexOf(result);
                    return (
                      <div
                        key={result.key}
                        id={`gs-${result.key}`}
                        role="option"
                        aria-selected={i === active}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => go(result)}
                        onMouseEnter={() => setActive(i)}
                        className={cx(
                          "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5",
                          i === active ? "bg-white/[0.07]" : "",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] text-fg">{result.label}</span>
                          <span className="block truncate text-[11px] text-faint">{result.detail}</span>
                        </span>
                        {result.risk ? (
                          <span className={cx("shrink-0 text-xs font-semibold", RISK_LEVEL_CLASS[result.risk.risk_level])}>
                            {result.risk.risk_score} {RISK_LEVEL_LABEL[result.risk.risk_level]}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
          {index && index.failed.length ? (
            <p className="border-t border-line-soft px-2.5 pt-2 text-[11px] text-risk-medium">
              Not searched (service unavailable): {index.failed.join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
