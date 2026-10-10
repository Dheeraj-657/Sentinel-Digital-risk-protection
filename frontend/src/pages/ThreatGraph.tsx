import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { m1, m2, m3, m4 } from "../lib/api";
import { parseAnswerLine } from "../lib/analyst";
import { errorMessage, useApi } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import { findBrandForUuid } from "../lib/brand-bridge";
import {
  boundsOf,
  buildGraph,
  clusterThreatIds,
  computeClusters,
  layoutGraph,
  type EdgeKind,
  type GraphEdge,
  type GraphNode,
  type Point,
} from "../lib/graph";
import {
  CLASSIFICATION_LABEL,
  cx,
  ENTITY_TYPE_LABEL,
  RISK_LEVEL_CLASS,
  RISK_LEVEL_LABEL,
  shortId,
} from "../lib/format";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from "../components/ui";
import type { AnalystResponse, RelatedThreatItem, RiskLevel } from "../lib/types";

const MAX_THREATS = 100;
const CONCURRENCY = 4;

const LEVEL_FILL: Record<RiskLevel, string> = {
  LOW: "var(--color-risk-low)",
  MEDIUM: "var(--color-risk-medium)",
  HIGH: "var(--color-risk-high)",
  CRITICAL: "var(--color-risk-critical)",
};
const LEVEL_RANK: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

const EDGE_LABEL: Record<EdgeKind, string> = {
  VERDICT: "Risk-engine verdict",
  SHARED_DOMAIN: "Shared domain",
  SHARED_IDENTIFIER: "Shared identifier",
};

/** Loads /related for every threat (bounded, concurrent, cancellable). */
function useRelations(threatIds: string[] | null, tenant: string) {
  const [state, setState] = useState<{
    map: Map<string, RelatedThreatItem[]>;
    done: number;
    failed: string[];
    warnings: string[];
    loading: boolean;
  }>({ map: new Map(), done: 0, failed: [], warnings: [], loading: false });
  const key = threatIds?.join(",") ?? "";

  useEffect(() => {
    if (!threatIds) return;
    const controller = new AbortController();
    const map = new Map<string, RelatedThreatItem[]>();
    const failed: string[] = [];
    const warnings: string[] = [];
    let done = 0;
    let cursor = 0;
    setState({ map, done: 0, failed, warnings, loading: true });
    const worker = async () => {
      while (cursor < threatIds.length && !controller.signal.aborted) {
        const id = threatIds[cursor++];
        try {
          const res = await m2.getRelated(id, tenant, controller.signal);
          map.set(id, res?.items ?? []);
          warnings.push(...(res?.warnings ?? []));
        } catch {
          if (controller.signal.aborted) return;
          failed.push(id);
        }
        done++;
        if (!controller.signal.aborted) setState({ map: new Map(map), done, failed: [...failed], warnings: [...warnings], loading: done < threatIds.length });
      }
    };
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, threatIds.length) }, worker)).then(() => {
      if (!controller.signal.aborted) setState({ map: new Map(map), done, failed: [...failed], warnings: [...new Set(warnings)], loading: false });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tenant]);

  return state;
}

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

export function ThreatGraph() {
  const { tenant } = useTenant();
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  const view = params.get("view") === "table" ? "table" : "graph";

  const threats = useApi(() => m2.listThreats({ limit: MAX_THREATS }, tenant), [tenant]);
  const entities = useApi(() => m3.listEntities({ limit: 200 }, tenant), [tenant]);
  const brands = useApi(() => m1.listBrands(), []);

  const threatIds = useMemo(() => (threats.data ? threats.data.items.map((t) => t.threat_id) : null), [threats.data]);
  const relations = useRelations(threatIds, tenant);

  const [showBrands, setShowBrands] = useState(true);
  const [edgeKinds, setEdgeKinds] = useState<Record<EdgeKind, boolean>>({ VERDICT: true, SHARED_DOMAIN: true, SHARED_IDENTIFIER: true });
  const [minLevel, setMinLevel] = useState<RiskLevel | "">("");
  const [entityTypes, setEntityTypes] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(focus ? { kind: "node", id: `e:${focus}` } : null);

  const full = useMemo(() => {
    if (!threats.data) return null;
    return buildGraph({
      threats: threats.data.items,
      entities: entities.data?.items ?? [],
      brands: brands.data?.items ?? [],
      brandForUuid: (uuid) => findBrandForUuid(brands.data?.items ?? [], uuid),
      related: relations.map,
    });
  }, [threats.data, entities.data, brands.data, relations.map]);

  const presentTypes = useMemo(
    () => [...new Set((full?.nodes ?? []).filter((n) => n.kind === "entity").map((n) => n.entityType ?? "OTHER"))],
    [full],
  );

  const graph = useMemo(() => {
    if (!full) return null;
    const keepEntity = (n: GraphNode) =>
      (!minLevel || (n.level && LEVEL_RANK[n.level] >= LEVEL_RANK[minLevel])) &&
      (entityTypes.size === 0 || entityTypes.has(n.entityType ?? "OTHER"));
    let nodes = full.nodes.filter((n) => (n.kind === "entity" ? keepEntity(n) : n.kind === "brand" ? showBrands : true));
    const ids = new Set(nodes.map((n) => n.id));
    let edges = full.edges.filter((e) => edgeKinds[e.kind] && ids.has(e.source) && ids.has(e.target));
    // Hubs and brands with no remaining edge are dropped so filters stay readable.
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
    nodes = nodes.filter((n) => n.kind === "entity" || linked.has(n.id));
    const kept = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
    return { nodes, edges, clusters: computeClusters(nodes, edges) };
  }, [full, showBrands, edgeKinds, minLevel, entityTypes]);

  const positions = useMemo(() => (graph ? layoutGraph(graph.nodes, graph.edges) : new Map<string, Point>()), [graph]);

  const setView = (next: "graph" | "table") => {
    const p = new URLSearchParams(params);
    if (next === "table") p.set("view", "table");
    else p.delete("view");
    setParams(p, { replace: true });
  };

  const loadingBase = threats.loading || entities.loading || brands.loading;

  return (
    <>
      <PageHeader
        title="Threat graph"
        description="Entities, the brands they were scored against, and identifiers they share. Every edge comes from a backend record; nothing is inferred in the console."
        actions={
          <div role="radiogroup" aria-label="View" className="flex rounded-md border border-line p-0.5">
            {(["graph", "table"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cx("rounded px-3 py-1 text-xs", view === v ? "bg-white/[0.08] text-fg" : "text-muted hover:text-fg")}
              >
                {v === "graph" ? "Graph" : "Table"}
              </button>
            ))}
          </div>
        }
      />

      {threats.error ? (
        <Card>
          <ErrorState error={threats.error} onRetry={threats.reload} context="threats" />
        </Card>
      ) : loadingBase || !graph ? (
        <Skeleton className="h-[32rem] w-full" />
      ) : full && full.nodes.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to draw yet"
            description="The graph is built from risk-engine verdicts. Run an analysis to add the first entity."
            action={
              <Link to="/analysis/new" className="rounded-md bg-action px-3 py-1.5 text-xs font-semibold text-on-action">
                New threat analysis
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            <Filters
              showBrands={showBrands}
              setShowBrands={setShowBrands}
              edgeKinds={edgeKinds}
              setEdgeKinds={setEdgeKinds}
              minLevel={minLevel}
              setMinLevel={setMinLevel}
              presentTypes={presentTypes}
              entityTypes={entityTypes}
              setEntityTypes={setEntityTypes}
            />
            <StatusLine
              loading={relations.loading}
              done={relations.done}
              total={threatIds?.length ?? 0}
              failed={relations.failed.length}
              truncated={(threats.data?.total ?? 0) > MAX_THREATS}
              nodes={graph.nodes.length}
              edges={graph.edges.length}
            />
            {view === "graph" ? (
              <GraphCanvas graph={graph} positions={positions} selection={selection} onSelect={setSelection} focusId={focus ? `e:${focus}` : null} />
            ) : (
              <EdgeTable graph={graph} onSelect={setSelection} />
            )}
          </div>
          <div className="space-y-4">
            <DetailPanel graph={graph} selection={selection} onSelect={setSelection} />
            <ClustersPanel clusters={graph.clusters} nodes={graph.nodes} onSelect={setSelection} tenant={tenant} />
            {relations.warnings.length ? (
              <p className="text-xs text-risk-medium">Engine warnings: {relations.warnings.slice(0, 3).join(" ")}</p>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- controls */

function Filters({
  showBrands,
  setShowBrands,
  edgeKinds,
  setEdgeKinds,
  minLevel,
  setMinLevel,
  presentTypes,
  entityTypes,
  setEntityTypes,
}: {
  showBrands: boolean;
  setShowBrands: (v: boolean) => void;
  edgeKinds: Record<EdgeKind, boolean>;
  setEdgeKinds: (v: Record<EdgeKind, boolean>) => void;
  minLevel: RiskLevel | "";
  setMinLevel: (v: RiskLevel | "") => void;
  presentTypes: string[];
  entityTypes: Set<string>;
  setEntityTypes: (v: Set<string>) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line-soft bg-panel px-3 py-2 text-xs">
      <legend className="sr-only">Graph filters</legend>
      {(Object.keys(EDGE_LABEL) as EdgeKind[]).map((kind) => (
        <label key={kind} className="flex items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={edgeKinds[kind]}
            onChange={(e) => setEdgeKinds({ ...edgeKinds, [kind]: e.target.checked })}
            className="accent-[var(--color-action)]"
          />
          {EDGE_LABEL[kind]}
        </label>
      ))}
      <label className="flex items-center gap-1.5 text-muted">
        <input type="checkbox" checked={showBrands} onChange={(e) => setShowBrands(e.target.checked)} className="accent-[var(--color-action)]" />
        Brands
      </label>
      <label className="flex items-center gap-1.5 text-muted">
        Minimum risk
        <select value={minLevel} onChange={(e) => setMinLevel(e.target.value as RiskLevel | "")} className="rounded border border-line bg-ink/50 px-1.5 py-0.5 text-fg">
          <option value="">Any</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
      </label>
      {presentTypes.length > 1 ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-faint">Entity type</span>
          {presentTypes.map((type) => {
            const on = entityTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(entityTypes);
                  if (on) next.delete(type);
                  else next.add(type);
                  setEntityTypes(next);
                }}
                className={cx("rounded border px-1.5 py-0.5", on ? "border-action text-fg" : "border-line text-muted hover:text-fg")}
              >
                {ENTITY_TYPE_LABEL[type] ?? type}
              </button>
            );
          })}
        </span>
      ) : null}
    </fieldset>
  );
}

function StatusLine({
  loading,
  done,
  total,
  failed,
  truncated,
  nodes,
  edges,
}: {
  loading: boolean;
  done: number;
  total: number;
  failed: number;
  truncated: boolean;
  nodes: number;
  edges: number;
}) {
  return (
    <p className="text-xs text-muted" aria-live="polite">
      {loading ? `Resolving relations from the risk engine: ${done} of ${total} verdicts. ` : ""}
      {nodes} nodes, {edges} edges.
      {failed ? <span className="text-risk-medium"> Relations for {failed} verdict{failed === 1 ? "" : "s"} could not be loaded and are missing from the graph.</span> : null}
      {truncated ? <span> Only the {MAX_THREATS} highest-risk verdicts are drawn.</span> : null}
    </p>
  );
}

/* ------------------------------------------------------------------ canvas */

function nodeRadius(node: GraphNode): number {
  if (node.kind === "brand") return 16;
  if (node.kind === "identifier") return 9;
  return 11 + Math.round(((node.score ?? 0) / 100) * 9);
}

function GraphCanvas({
  graph,
  positions,
  selection,
  onSelect,
  focusId,
}: {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  positions: Map<string, Point>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  focusId: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(
    (only?: string[]) => {
      const pts = only ? only.map((id) => positions.get(id)).filter((p): p is Point => !!p) : [...positions.values()];
      const b = boundsOf(pts, only ? 160 : 80);
      const k = Math.min(2.2, Math.max(0.2, Math.min(size.w / b.width, size.h / b.height)));
      setView({ k, x: size.w / 2 - (b.minX + b.width / 2) * k, y: size.h / 2 - (b.minY + b.height / 2) * k });
    },
    [positions, size],
  );

  // Fit on new layout; centre on the focused entity when one is requested.
  useEffect(() => {
    if (focusId && positions.has(focusId)) {
      const neighbours = graph.edges.filter((e) => e.source === focusId || e.target === focusId).flatMap((e) => [e.source, e.target]);
      fit([focusId, ...neighbours]);
    } else fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, size.w, size.h]);

  const zoomBy = (factor: number, cx = size.w / 2, cy = size.h / 2) =>
    setView((v) => {
      const k = Math.min(4, Math.max(0.15, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });

  const selectedNode = selection?.kind === "node" ? selection.id : null;
  const selectedEdge = selection?.kind === "edge" ? selection.id : null;
  const neighbourIds = useMemo(() => {
    if (!selectedNode) return null;
    const set = new Set([selectedNode]);
    const hubs: string[] = [];
    for (const e of graph.edges) {
      const other = e.source === selectedNode ? e.target : e.target === selectedNode ? e.source : null;
      if (!other) continue;
      set.add(other);
      if (other.startsWith("i:")) hubs.push(other);
    }
    // Entities reached through a shared identifier are the link that matters: include them.
    for (const e of graph.edges) {
      if (hubs.includes(e.target)) set.add(e.source);
    }
    return set;
  }, [graph.edges, selectedNode]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-line-soft bg-panel">
      <div ref={wrapRef} className="h-[min(62vh,560px)] min-h-[360px] w-full touch-none select-none">
        <svg
          width="100%"
          height="100%"
          role="application"
          aria-label="Threat relationship graph. Use Tab to move between nodes and Enter to select. A table view is available."
          onWheel={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
          }}
          onPointerDown={(e) => {
            if ((e.target as Element).closest("[data-hit]")) return;
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
          }}
          onPointerUp={() => {
            if (drag.current && !drag.current.moved) onSelect(null);
            drag.current = null;
          }}
          className="cursor-grab active:cursor-grabbing"
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {graph.edges.map((edge) => {
              const a = positions.get(edge.source);
              const b = positions.get(edge.target);
              if (!a || !b) return null;
              const dim = neighbourIds && !(neighbourIds.has(edge.source) && neighbourIds.has(edge.target));
              const active = selectedEdge === edge.id;
              const color =
                edge.kind === "VERDICT"
                  ? edge.threat
                    ? LEVEL_FILL[edge.threat.risk_level]
                    : "var(--color-faint)"
                  : "var(--color-evidence)";
              return (
                <g key={edge.id} opacity={dim ? 0.15 : 1}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={color}
                    strokeOpacity={active ? 1 : 0.55}
                    strokeWidth={(active ? 3 : edge.kind === "VERDICT" ? 1.4 : 2) / Math.sqrt(view.k)}
                    strokeDasharray={edge.kind === "VERDICT" ? "5 4" : undefined}
                  />
                  <line
                    data-hit
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth={12 / view.k}
                    className="cursor-pointer"
                    onClick={() => onSelect({ kind: "edge", id: edge.id })}
                  >
                    <title>{EDGE_LABEL[edge.kind]}</title>
                  </line>
                </g>
              );
            })}
            {graph.nodes.map((node) => {
              const p = positions.get(node.id);
              if (!p) return null;
              const r = nodeRadius(node);
              const selected = selectedNode === node.id;
              const dim = neighbourIds && !neighbourIds.has(node.id);
              return (
                <g
                  key={node.id}
                  data-hit
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={dim ? 0.25 : 1}
                  tabIndex={0}
                  role="button"
                  aria-label={nodeAria(node)}
                  aria-pressed={selected}
                  onClick={() => onSelect({ kind: "node", id: node.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect({ kind: "node", id: node.id });
                    }
                  }}
                  className="cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100"
                >
                  <circle className="ring opacity-0" r={r + 6} fill="none" stroke="var(--color-action)" strokeWidth={2} />
                  {selected ? <circle r={r + 5} fill="none" stroke="var(--color-action)" strokeWidth={2.5} /> : null}
                  {node.kind === "brand" ? (
                    <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={5} fill="#262a33" stroke="var(--color-fg)" strokeOpacity={0.6} strokeWidth={1.5} />
                  ) : node.kind === "identifier" ? (
                    <rect x={-r} y={-r} width={r * 2} height={r * 2} transform="rotate(45)" fill="#1d2430" stroke="var(--color-evidence)" strokeWidth={1.5} />
                  ) : (
                    <circle r={r} fill={node.level ? LEVEL_FILL[node.level] : "#3a3f4a"} fillOpacity={0.9} stroke="#0b0c0f" strokeWidth={2} />
                  )}
                  <text
                    y={r + 14 / Math.sqrt(view.k)}
                    textAnchor="middle"
                    fontSize={11 / Math.sqrt(view.k)}
                    fill="var(--color-fg)"
                    fillOpacity={node.kind === "identifier" ? 0.75 : 0.92}
                    style={{ paintOrder: "stroke", stroke: "#0b0c0f", strokeWidth: 3 / Math.sqrt(view.k) }}
                  >
                    {truncate(node.label, 26)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="absolute right-2 top-2 flex flex-col gap-1" aria-label="Zoom controls">
        <button type="button" onClick={() => zoomBy(1.25)} className="glass-strong size-8 rounded-md border border-line text-fg hover:border-action/60" aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(0.8)} className="glass-strong size-8 rounded-md border border-line text-fg hover:border-action/60" aria-label="Zoom out">−</button>
        <button type="button" onClick={() => fit()} className="glass-strong h-8 rounded-md border border-line px-1.5 text-[11px] text-fg hover:border-action/60" aria-label="Fit graph to view">Fit</button>
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft px-3 py-2 text-[11px] text-muted">
      <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-risk-high" aria-hidden />Entity (color = highest verdict)</span>
      <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm border border-fg/60 bg-[#262a33]" aria-hidden />Protected brand</span>
      <span className="flex items-center gap-1"><span className="size-2 rotate-45 border border-evidence bg-[#1d2430]" aria-hidden />Shared identifier</span>
      <span className="flex items-center gap-1"><span className="w-4 border-t border-dashed border-muted" aria-hidden />Verdict</span>
      <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-evidence" aria-hidden />Exact match</span>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function nodeAria(node: GraphNode): string {
  if (node.kind === "brand") return `Protected brand ${node.label}`;
  if (node.kind === "identifier") return `Shared ${node.identifier?.key} ${node.label}`;
  return `Entity ${node.label}${node.score !== null && node.level ? `, highest verdict ${node.score} ${RISK_LEVEL_LABEL[node.level]}` : ", no verdict"}`;
}

/* ------------------------------------------------------------- side panels */

function DetailPanel({
  graph,
  selection,
  onSelect,
}: {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  if (!selection) {
    return (
      <Card>
        <CardHeader title="Details" />
        <p className="px-4 py-4 text-[13px] text-muted">Select a node or an edge to inspect it. Drag to pan, scroll to zoom.</p>
      </Card>
    );
  }
  if (selection.kind === "edge") {
    const edge = graph.edges.find((e) => e.id === selection.id);
    if (!edge) return null;
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    return (
      <Card>
        <CardHeader title={EDGE_LABEL[edge.kind]} description={edge.basis === "EXACT_ATTRIBUTE_MATCH" ? "Exact stored-attribute match from the risk engine." : "Verdict produced by the risk engine."} />
        <dl className="space-y-2.5 px-4 py-4 text-[13px]">
          <Row label="From"><NodeLink node={a} onSelect={onSelect} /></Row>
          <Row label="To"><NodeLink node={b} onSelect={onSelect} /></Row>
          <Row label="Basis"><span className="font-mono text-xs">{edge.basis}</span></Row>
          {edge.threat ? (
            <>
              <Row label="Verdict">
                <span className={cx("font-semibold", RISK_LEVEL_CLASS[edge.threat.risk_level])}>
                  {edge.threat.risk_score} {RISK_LEVEL_LABEL[edge.threat.risk_level]}
                </span>{" "}
                {CLASSIFICATION_LABEL[edge.threat.classification]}, {edge.threat.status.toLowerCase()}
              </Row>
              <Link to={`/threats/${edge.threat.threat_id}`} className="inline-block text-xs text-action hover:text-fg">Open threat record</Link>
            </>
          ) : (
            <Row label="Evidence">
              {edge.evidenceIds.length ? (
                <span className="flex flex-wrap gap-1">
                  {edge.evidenceIds.map((id) => (
                    <Link key={id} to={`/investigate/${a?.id.slice(2)}?tab=evidence&ev=${id}`} className="rounded border border-evidence/40 bg-evidence/10 px-1 font-mono text-[10px] text-evidence">
                      ev {shortId(id)}
                    </Link>
                  ))}
                </span>
              ) : (
                <span className="text-muted">No evidence item corresponds to this value; the link rests on stored identifiers only.</span>
              )}
            </Row>
          )}
        </dl>
      </Card>
    );
  }
  const node = nodeById.get(selection.id);
  if (!node) {
    return (
      <Card>
        <CardHeader title="Details" />
        <p className="px-4 py-4 text-[13px] text-muted">That entity is not in the current graph. It may have no verdict yet, or a filter hides it.</p>
      </Card>
    );
  }
  const neighbours = graph.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => ({ edge: e, other: nodeById.get(e.source === node.id ? e.target : e.source) }));

  return (
    <Card>
      <CardHeader
        title={node.label}
        description={node.kind === "entity" ? ENTITY_TYPE_LABEL[node.entityType ?? ""] ?? "Entity" : node.kind === "brand" ? "Protected brand" : `Shared ${node.identifier?.key}`}
      />
      <div className="space-y-3 px-4 py-4 text-[13px]">
        {node.kind === "entity" ? (
          <>
            {node.entity ? (
              <p className="break-words font-mono text-xs text-muted">{Object.values(node.entity.identifiers).join(", ")}</p>
            ) : null}
            <ul className="space-y-1">
              {(node.verdicts ?? []).map((v) => (
                <li key={v.threat_id} className="flex items-center justify-between gap-2">
                  <Link to={`/threats/${v.threat_id}`} className="text-fg hover:text-action">
                    vs {nodeById.get(`b:${v.brand_id}`)?.label ?? "brand"}
                  </Link>
                  <span className={cx("font-mono text-xs font-semibold", RISK_LEVEL_CLASS[v.risk_level])}>{v.risk_score}</span>
                </li>
              ))}
            </ul>
            <Link
              to={`/investigate/${node.id.slice(2)}`}
              className="block rounded-md bg-action px-3 py-1.5 text-center text-[13px] font-semibold text-on-action hover:bg-action-strong"
            >
              Open investigation
            </Link>
          </>
        ) : node.kind === "brand" ? (
          node.brand ? (
            <>
              <p className="font-mono text-xs text-muted">{node.brand.officialDomains.join(", ") || "No official domains"}</p>
              <Link to={`/brands/${node.brand.id}`} className="text-xs text-action hover:text-fg">Open brand</Link>
            </>
          ) : (
            <p className="text-muted">This brand id is not in the brand registry (it may have been deleted).</p>
          )
        ) : (
          <p className="text-muted">
            Entities below store exactly <span className="font-mono text-fg">{node.label}</span> as their {node.identifier?.key}. This is a possible link for
            review, not a confirmed campaign.
          </p>
        )}
        {neighbours.length ? (
          <div className="border-t border-line-soft pt-3">
            <p className="mb-1.5 text-xs text-faint">Connected</p>
            <ul className="space-y-1">
              {neighbours.map(({ edge, other }) => (
                <li key={edge.id} className="flex items-center justify-between gap-2">
                  <NodeLink node={other} onSelect={onSelect} />
                  <button type="button" onClick={() => onSelect({ kind: "edge", id: edge.id })} className="text-[11px] text-muted hover:text-fg">
                    {EDGE_LABEL[edge.kind]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 text-fg">{children}</dd>
    </div>
  );
}

function NodeLink({ node, onSelect }: { node: GraphNode | undefined; onSelect: (s: Selection) => void }) {
  if (!node) return <span className="text-muted">Unknown</span>;
  return (
    <button type="button" onClick={() => onSelect({ kind: "node", id: node.id })} className="min-w-0 truncate text-left text-fg hover:text-action">
      {node.label}
    </button>
  );
}

function ClusterSummary({ threatIds, tenant }: { threatIds: string[]; tenant: string }) {
  const [state, setState] = useState<{ loading: boolean; answer?: AnalystResponse; error?: string }>({ loading: false });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const run = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ loading: true });
    try {
      const answer = await m4.askAnalyst(
        { question: "Summarize this potential campaign.", cluster_threat_ids: threatIds },
        tenant,
        controller.signal,
      );
      if (!controller.signal.aborted) setState({ loading: false, answer });
    } catch (err) {
      if (!controller.signal.aborted) setState({ loading: false, error: errorMessage(err) });
    }
  };
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={run}
        disabled={state.loading || threatIds.length < 2}
        className="rounded-md border border-ai/40 px-2 py-1 text-[11px] font-medium text-ai transition hover:border-ai disabled:opacity-50"
      >
        {state.loading ? "Summarizing…" : state.answer ? "Re-run analyst summary" : "Summarize potential campaign"}
      </button>
      {state.error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-risk-critical">
          The analyst could not answer: {state.error}
        </p>
      ) : null}
      {state.answer ? (
        <div className="mt-2 space-y-1 rounded-md border border-ai/25 bg-ai/[0.05] px-2.5 py-2 text-[12px] leading-relaxed text-fg">
          <p className="text-[10px] text-faint">
            {state.answer.source === "GROQ" ? `AI assessment · ${state.answer.model ?? ""}` : "Evidence summary (template)"}
          </p>
          {state.answer.answer.split("\n").map((line, i) =>
            line.trim() === "" ? (
              <div key={i} className="h-1" aria-hidden />
            ) : (
              <p key={i} className={line.startsWith("- ") ? "pl-3 -indent-3" : undefined}>
                {parseAnswerLine(line).map((part, j) =>
                  part.kind === "text" ? (
                    <span key={j}>{part.text}</span>
                  ) : part.kind === "evidence" ? (
                    <span key={j} title={`Evidence ${part.id}`} className="mx-0.5 rounded border border-evidence/40 px-1 font-mono text-[10px] text-evidence">
                      ev {shortId(part.id)}
                    </span>
                  ) : (
                    <Link
                      key={j}
                      to={part.kind === "threat" ? `/threats/${part.id}` : `/investigate/${part.id}`}
                      className="mx-0.5 rounded border border-line px-1 font-mono text-[10px] text-muted hover:border-action/60 hover:text-fg"
                    >
                      {part.kind} {shortId(part.id)}
                    </Link>
                  ),
                )}
              </p>
            ),
          )}
          {state.answer.notes.length ? <p className="text-[10px] text-faint">{state.answer.notes.join(" ")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ClustersPanel({
  clusters,
  nodes,
  onSelect,
  tenant,
}: {
  clusters: ReturnType<typeof computeClusters>;
  nodes: GraphNode[];
  onSelect: (s: Selection) => void;
  tenant: string;
}) {
  const name = new Map(nodes.map((n) => [n.id, n.label]));
  return (
    <Card>
      <CardHeader
        title="Linked clusters"
        description="Groups of entities joined by exact shared identifiers. Campaign detection is not implemented in the risk engine; clusters are leads, not confirmed campaigns."
      />
      {clusters.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted">No two entities share a stored identifier in the current view.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {clusters.map((c) => (
            <li key={c.id} className="space-y-1.5 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-fg">{c.entityIds.length} entities</span>
                {c.maxLevel ? <Badge tone={c.maxLevel.toLowerCase() as "low"}>{`max ${c.maxScore} ${RISK_LEVEL_LABEL[c.maxLevel]}`}</Badge> : null}
              </div>
              <p className="font-mono text-[11px] text-muted">{c.identifiers.map((i) => `${i.key}: ${i.value}`).join(", ")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {c.entityIds.map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => onSelect({ kind: "node", id: `e:${id}` })} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-fg hover:border-action/60">
                      {name.get(`e:${id}`) ?? shortId(id)}
                    </button>
                  </li>
                ))}
              </ul>
              <ClusterSummary threatIds={clusterThreatIds(c, nodes)} tenant={tenant} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EdgeTable({ graph, onSelect }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] }; onSelect: (s: Selection) => void }) {
  const name = new Map(graph.nodes.map((n) => [n.id, n]));
  if (graph.edges.length === 0) {
    return (
      <Card>
        <EmptyState title="No edges in this view" description="Adjust the filters to include verdicts or shared identifiers." />
      </Card>
    );
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">Graph edges</caption>
        <thead>
          <tr className="border-b border-line-soft text-xs text-faint">
            <th scope="col" className="px-4 py-2.5 font-medium">From</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Relation</th>
            <th scope="col" className="px-4 py-2.5 font-medium">To</th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Basis</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {graph.edges.map((edge) => {
            const a = name.get(edge.source);
            const b = name.get(edge.target);
            return (
              <tr key={edge.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2">
                  {a?.kind === "entity" ? (
                    <Link to={`/investigate/${a.id.slice(2)}`} className="text-fg hover:text-action">{a.label}</Link>
                  ) : (
                    a?.label
                  )}
                </td>
                <td className="px-4 py-2 text-muted">{EDGE_LABEL[edge.kind]}</td>
                <td className="px-4 py-2 font-mono text-xs">{b?.label}</td>
                <td className="hidden px-4 py-2 font-mono text-[11px] text-faint md:table-cell">{edge.basis}</td>
                <td className="px-4 py-2 text-xs">
                  {edge.threat ? (
                    <span className={RISK_LEVEL_CLASS[edge.threat.risk_level]}>{edge.threat.risk_score} {RISK_LEVEL_LABEL[edge.threat.risk_level]}</span>
                  ) : (
                    <button type="button" onClick={() => onSelect({ kind: "edge", id: edge.id })} className="text-muted hover:text-fg">
                      {edge.evidenceIds.length} evidence
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

