/**
 * Threat graph model — presentation only.
 *
 * Nodes and edges are built strictly from records the backend returns:
 *   - entity → brand "verdict" edges come from Module 2 threat records;
 *   - shared-identifier edges come from Module 2's /threats/{id}/related
 *     (exact stored-attribute matches). The console never computes its own
 *     relationships, similarity or campaigns.
 * "Linked clusters" are connected components over those backend edges only
 * (brands excluded), labelled as such — not campaign detection.
 */
import type {
  M1Brand,
  M3EntityListItem,
  RelatedThreatItem,
  RiskLevel,
  ThreatSummary,
} from "./types";

export type NodeKind = "entity" | "brand" | "identifier";
export type EdgeKind = "VERDICT" | "SHARED_DOMAIN" | "SHARED_IDENTIFIER";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** entity: highest verdict level; others: null */
  level: RiskLevel | null;
  score: number | null;
  entityType?: string;
  entity?: M3EntityListItem;
  brand?: M1Brand;
  brandUuid?: string;
  identifier?: { key: string; value: string };
  verdicts?: ThreatSummary[];
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  /** VERDICT: the threat record; shared: evidence ids on the entity side. */
  threat?: ThreatSummary;
  basis: "RISK_ENGINE_VERDICT" | "EXACT_ATTRIBUTE_MATCH";
  evidenceIds: string[];
}

export interface Cluster {
  id: string;
  entityIds: string[];
  identifiers: { key: string; value: string }[];
  maxScore: number;
  maxLevel: RiskLevel | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Cluster[];
}

const LEVEL_RANK: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export function maxLevel(levels: RiskLevel[]): RiskLevel | null {
  return levels.reduce<RiskLevel | null>((best, l) => (!best || LEVEL_RANK[l] > LEVEL_RANK[best] ? l : best), null);
}

export function buildGraph(input: {
  threats: ThreatSummary[];
  entities: M3EntityListItem[];
  brands: M1Brand[];
  brandForUuid: (uuid: string) => M1Brand | undefined;
  related: Map<string, RelatedThreatItem[]>;
}): Graph {
  const entityById = new Map(input.entities.map((e) => [e.entity_id, e]));
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const threatEntity = new Map(input.threats.map((t) => [t.threat_id, t.entity_id]));

  const entityNode = (entityId: string, fallbackName?: string | null): GraphNode => {
    const key = `e:${entityId}`;
    let node = nodes.get(key);
    if (!node) {
      const entity = entityById.get(entityId);
      node = {
        id: key,
        kind: "entity",
        label: entity?.display_name ?? fallbackName ?? `Entity ${entityId.slice(0, 8)}`,
        level: null,
        score: null,
        entityType: entity?.entity_type,
        entity,
        verdicts: [],
      };
      nodes.set(key, node);
    }
    return node;
  };

  for (const t of input.threats) {
    const en = entityNode(t.entity_id);
    en.verdicts!.push(t);
    const brand = input.brandForUuid(t.brand_id);
    const bKey = `b:${t.brand_id}`;
    if (!nodes.has(bKey)) {
      nodes.set(bKey, {
        id: bKey,
        kind: "brand",
        label: brand?.name ?? `Unregistered brand ${t.brand_id.slice(0, 8)}`,
        level: null,
        score: null,
        brand,
        brandUuid: t.brand_id,
      });
    }
    edges.set(`v:${t.threat_id}`, {
      id: `v:${t.threat_id}`,
      kind: "VERDICT",
      source: en.id,
      target: bKey,
      threat: t,
      basis: "RISK_ENGINE_VERDICT",
      evidenceIds: [],
    });
  }

  for (const [threatId, items] of input.related) {
    const fromEntity = threatEntity.get(threatId);
    if (!fromEntity) continue;
    for (const r of items) {
      if (r.entity_id === fromEntity) continue; // same entity, other brand: shown by verdict edges
      const hubKey = `i:${r.shared_attribute.key}:${r.shared_attribute.value}`;
      if (!nodes.has(hubKey)) {
        nodes.set(hubKey, {
          id: hubKey,
          kind: "identifier",
          label: r.shared_attribute.value,
          level: null,
          score: null,
          identifier: { ...r.shared_attribute },
        });
      }
      const kind: EdgeKind = r.relation_type === "SHARED_DOMAIN" ? "SHARED_DOMAIN" : "SHARED_IDENTIFIER";
      const sides: [string, string[], string | null][] = [
        [fromEntity, r.target_evidence_ids, null],
        [r.entity_id, r.evidence_ids, r.entity_display_name],
      ];
      for (const [entityId, evidenceIds, name] of sides) {
        const en = entityNode(entityId, name);
        const edgeKey = `s:${entityId}:${hubKey}`;
        const existing = edges.get(edgeKey);
        if (existing) {
          existing.evidenceIds = [...new Set([...existing.evidenceIds, ...evidenceIds])];
        } else {
          edges.set(edgeKey, {
            id: edgeKey,
            kind,
            source: en.id,
            target: hubKey,
            basis: "EXACT_ATTRIBUTE_MATCH",
            evidenceIds: [...new Set(evidenceIds)],
          });
        }
      }
    }
  }

  for (const node of nodes.values()) {
    if (node.kind !== "entity" || !node.verdicts?.length) continue;
    const top = [...node.verdicts].sort((a, b) => b.risk_score - a.risk_score)[0];
    node.level = top.risk_level;
    node.score = top.risk_score;
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], clusters: computeClusters([...nodes.values()], [...edges.values()]) };
}

/** Connected components of entities joined through shared-identifier hubs. */
export function computeClusters(nodes: GraphNode[], edges: GraphEdge[]): Cluster[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const n of nodes) if (n.kind !== "brand") parent.set(n.id, n.id);
  for (const e of edges) if (e.kind !== "VERDICT") union(e.source, e.target);

  const groups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.kind === "brand") continue;
    const root = find(n.id);
    groups.set(root, [...(groups.get(root) ?? []), n]);
  }
  const clusters: Cluster[] = [];
  for (const members of groups.values()) {
    const entities = members.filter((m) => m.kind === "entity");
    if (entities.length < 2) continue;
    const levels = entities.map((e) => e.level).filter((l): l is RiskLevel => !!l);
    clusters.push({
      id: `c:${entities.map((e) => e.id).sort()[0]}`,
      entityIds: entities.map((e) => e.id.slice(2)),
      identifiers: members.filter((m) => m.kind === "identifier").map((m) => m.identifier!),
      maxScore: Math.max(0, ...entities.map((e) => e.score ?? 0)),
      maxLevel: maxLevel(levels),
    });
  }
  return clusters.sort((a, b) => b.maxScore - a.maxScore);
}

/* ------------------------------------------------------------------ layout */

export interface Point {
  x: number;
  y: number;
}

/**
 * Deterministic force-directed layout (no randomness, so the same data always
 * draws the same picture). O(n²) per step — fine for the ≤ a few hundred nodes
 * a tenant view holds.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], iterations = 320): Map<string, Point> {
  const n = nodes.length;
  const pos = new Map<string, Point>();
  if (n === 0) return pos;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  // Brands on an outer ring, everything else on an inner spiral.
  nodes.forEach((node, i) => {
    const angle = i * 2.399963; // golden angle
    const r = node.kind === "brand" ? 340 : 60 + 14 * Math.sqrt(i) * 6;
    xs[i] = Math.cos(angle) * r;
    ys[i] = Math.sin(angle) * r;
  });
  const links: [number, number, number][] = [];
  for (const e of edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a !== undefined && b !== undefined) links.push([a, b, e.kind === "VERDICT" ? 170 : 90]);
  }

  for (let step = 0; step < iterations; step++) {
    const cooling = 1 - step / iterations;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = xs[i] - xs[j];
        let vy = ys[i] - ys[j];
        let d2 = vx * vx + vy * vy;
        if (d2 < 1) {
          vx = (i - j) * 0.5;
          vy = 1;
          d2 = 1;
        }
        const f = 9000 / d2;
        const d = Math.sqrt(d2);
        dx[i] += (vx / d) * f;
        dy[i] += (vy / d) * f;
        dx[j] -= (vx / d) * f;
        dy[j] -= (vy / d) * f;
      }
    }
    for (const [a, b, rest] of links) {
      const vx = xs[b] - xs[a];
      const vy = ys[b] - ys[a];
      const d = Math.max(1, Math.sqrt(vx * vx + vy * vy));
      const f = (d - rest) * 0.06;
      dx[a] += (vx / d) * f;
      dy[a] += (vy / d) * f;
      dx[b] -= (vx / d) * f;
      dy[b] -= (vy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= xs[i] * 0.012;
      dy[i] -= ys[i] * 0.012;
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      const cap = 40 * cooling + 1;
      const scale = len > cap ? cap / len : 1;
      xs[i] += dx[i] * scale;
      ys[i] += dy[i] * scale;
    }
  }
  nodes.forEach((node, i) => pos.set(node.id, { x: xs[i], y: ys[i] }));
  return pos;
}

export function boundsOf(points: Iterable<Point>, pad = 60): { minX: number; minY: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { minX: -100, minY: -100, width: 200, height: 200 };
  return { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
