"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import type { EntityType, RiskLevel } from "@/lib/engine/types";
import { ENTITY_TYPES, RISK_LEVELS } from "@/lib/engine/types";
import { ENTITY_LABEL, LEVEL_STYLE, formatDateTime, timeAgo, cx } from "@/lib/ui";
import { Button, EmptyState, ErrorState, LevelBadge } from "@/components/ui/primitives";

interface Row {
  id: string;
  entityType: EntityType;
  target: string;
  displayName: string;
  brandName: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  confidenceScore: number;
  aiSource: string;
  signalCount: number;
  createdAt: string;
}

export function HistoryTable() {
  const params = useSearchParams();
  const initialLevel = RISK_LEVELS.find((l) => l === params.get("level")) ?? "";
  const initialType = ENTITY_TYPES.find((t) => t === params.get("type")) ?? "";
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [type, setType] = useState<EntityType | "">(initialType);
  const [level, setLevel] = useState<RiskLevel | "">(initialLevel);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error" | "more">("loading");

  const load = useCallback(
    async (after: string | null) => {
      setState(after ? "more" : "loading");
      const sp = new URLSearchParams({ limit: "25" });
      if (type) sp.set("type", type);
      if (level) sp.set("level", level);
      if (query) sp.set("q", query);
      if (after) sp.set("cursor", after);
      try {
        const res = await fetch(`/api/scans?${sp}`);
        if (!res.ok) throw new Error();
        const j = (await res.json()) as { items: Row[]; nextCursor: string | null; total: number };
        setRows((prev) => (after ? [...prev, ...j.items] : j.items));
        setCursor(j.nextCursor);
        setTotal(j.total);
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [type, level, query],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = Boolean(type || level || query);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">Search scans</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search domain, handle or package"
            className="w-full rounded-md border border-line bg-panel py-2 pr-3 pl-9 text-sm focus:border-action focus:outline-none"
          />
        </label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EntityType | "")}
          aria-label="Entity type"
          className="rounded-md border border-line bg-panel px-3 py-2 text-sm"
        >
          <option value="">All entity types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ENTITY_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as RiskLevel | "")}
          aria-label="Risk level"
          className="rounded-md border border-line bg-panel px-3 py-2 text-sm"
        >
          <option value="">All risk levels</option>
          {[...RISK_LEVELS].reverse().map((l) => (
            <option key={l} value={l}>
              {LEVEL_STYLE[l].label}
            </option>
          ))}
        </select>
        {state !== "loading" && <span className="text-sm text-faint">{total} scan{total === 1 ? "" : "s"}</span>}
      </div>

      {state === "error" && (
        <ErrorState
          title="Scan history didn't load"
          body="The server couldn't read the scan database."
          action={<Button variant="ghost" onClick={() => load(null)}>Try again</Button>}
        />
      )}

      {state === "loading" && (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-panel" />
          ))}
        </div>
      )}

      {(state === "ready" || state === "more") && rows.length === 0 && (
        <EmptyState
          title={filtered ? "No scans match these filters" : "No scans yet"}
          body={filtered ? "Clear a filter or search for something else." : "Run your first analysis to start building a history of suspicious entities."}
          action={
            !filtered && (
              <Link href="/scan" className="rounded-md bg-action px-4 py-2 text-sm font-semibold text-ink">
                Run an analysis
              </Link>
            )
          }
        />
      )}

      {rows.length > 0 && state !== "loading" && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-panel text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Brand</th>
                <th className="px-4 py-3 text-right font-medium">Confidence</th>
                <th className="px-4 py-3 text-right font-medium">Signals</th>
                <th className="px-4 py-3 font-medium">Scanned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((r) => (
                <tr key={r.id} className="group relative hover:bg-raised/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-8 text-right text-lg font-bold" style={{ color: LEVEL_STYLE[r.riskLevel].color }}>
                        {r.riskScore}
                      </span>
                      <LevelBadge level={r.riskLevel} size="sm" />
                    </div>
                  </td>
                  <td className="max-w-[340px] px-4 py-3">
                    <Link href={`/scans/${r.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                      <span className="block truncate font-mono text-[13px] text-fg group-hover:underline">{r.target}</span>
                    </Link>
                    <span className="text-xs text-faint">{ENTITY_LABEL[r.entityType]}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{r.brandName ?? <span className="text-faint">None</span>}</td>
                  <td className="px-4 py-3 text-right text-muted">{r.confidenceScore}</td>
                  <td className="px-4 py-3 text-right text-muted">{r.signalCount}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted" title={formatDateTime(r.createdAt)}>
                    {timeAgo(r.createdAt)}
                    {r.aiSource === "GROQ" && <span className="ml-2 text-xs text-ai">AI</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && state !== "loading" && (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" onClick={() => load(cursor)} disabled={state === "more"}>
            {state === "more" && <Loader2 className={cx("size-4 animate-spin")} aria-hidden />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
