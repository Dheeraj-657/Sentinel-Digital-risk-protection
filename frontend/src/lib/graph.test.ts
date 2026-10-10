import { describe, expect, it } from "vitest";
import { buildGraph, clusterThreatIds, layoutGraph } from "./graph";
import type { M3EntityListItem, RelatedThreatItem, ThreatSummary } from "./types";

const T = "2026-10-10T10:00:00Z";

function entity(id: string, name: string, identifiers: Record<string, string>): M3EntityListItem {
  return {
    entity_id: id,
    tenant_id: "t",
    entity_type: "WEBSITE",
    display_name: name,
    identifiers,
    attributes: {},
    created_at: T,
    updated_at: T,
  };
}

function threat(id: string, entityId: string, brandId: string, score: number): ThreatSummary {
  return {
    threat_id: id,
    entity_id: entityId,
    brand_id: brandId,
    risk_score: score,
    risk_level: score > 75 ? "CRITICAL" : score > 50 ? "HIGH" : score > 25 ? "MEDIUM" : "LOW",
    classification: "PHISHING",
    status: "OPEN",
    analysis_timestamp: T,
  };
}

function rel(threatId: string, entityId: string, key: string, value: string, ev: string[] = [], tev: string[] = []): RelatedThreatItem {
  return {
    threat_id: threatId,
    entity_id: entityId,
    entity_display_name: null,
    relation_type: key === "domain" ? "SHARED_DOMAIN" : "SHARED_IDENTIFIER",
    basis: "EXACT_ATTRIBUTE_MATCH",
    shared_attribute: { key, value },
    evidence_ids: ev,
    target_evidence_ids: tev,
  };
}

const base = {
  brands: [],
  brandForUuid: () => undefined,
  entities: [
    entity("A", "Acme Help", { domain: "acme-help.example" }),
    entity("B", "Acme Promo", { domain: "acme-help.example" }),
    entity("C", "Unrelated", { domain: "other.example" }),
  ],
};

describe("buildGraph", () => {
  it("draws only backend relations and never infers links from identifiers itself", () => {
    // A and B share a domain in their identifiers, but no /related response says so.
    const graph = buildGraph({
      ...base,
      threats: [threat("t1", "A", "brand-1", 60), threat("t2", "B", "brand-1", 30)],
      related: new Map(),
    });
    expect(graph.edges.every((e) => e.kind === "VERDICT")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "identifier")).toBe(false);
    expect(graph.clusters).toEqual([]);
  });

  it("links entities through an identifier hub from /related and forms a labelled cluster", () => {
    const graph = buildGraph({
      ...base,
      threats: [threat("t1", "A", "brand-1", 60), threat("t2", "B", "brand-2", 30), threat("t3", "C", "brand-1", 90)],
      related: new Map([
        ["t1", [rel("t2", "B", "domain", "acme-help.example", ["evB"], ["evA"])]],
        ["t2", [rel("t1", "A", "domain", "acme-help.example", ["evA"], ["evB"])]],
      ]),
    });
    const hub = graph.nodes.find((n) => n.kind === "identifier");
    expect(hub?.label).toBe("acme-help.example");
    const shared = graph.edges.filter((e) => e.kind === "SHARED_DOMAIN");
    expect(shared).toHaveLength(2);
    expect(shared.find((e) => e.source === "e:A")?.evidenceIds).toEqual(["evA"]);
    expect(graph.clusters).toHaveLength(1);
    expect(graph.clusters[0].entityIds.sort()).toEqual(["A", "B"]);
    expect(graph.clusters[0].maxLevel).toBe("HIGH");
  });

  it("does not cluster entities that only share a brand", () => {
    const graph = buildGraph({
      ...base,
      threats: [threat("t1", "A", "brand-1", 60), threat("t3", "C", "brand-1", 90)],
      related: new Map(),
    });
    expect(graph.clusters).toEqual([]);
  });

  it("ignores same-entity relations (already shown as verdict edges)", () => {
    const graph = buildGraph({
      ...base,
      threats: [threat("t1", "A", "brand-1", 60), threat("t2", "A", "brand-2", 40)],
      related: new Map([["t1", [rel("t2", "A", "domain", "acme-help.example")]]]),
    });
    expect(graph.nodes.filter((n) => n.kind === "identifier")).toHaveLength(0);
    expect(graph.nodes.find((n) => n.id === "e:A")?.score).toBe(60);
  });
});

describe("brand labels", () => {
  it("says 'registry unavailable' instead of 'unregistered' when Module 1 is down", () => {
    const g = (down: boolean) =>
      buildGraph({ ...base, threats: [threat("t1", "A", "brand-1234567", 60)], related: new Map(), brandRegistryUnavailable: down });
    expect(g(true).nodes.find((n) => n.kind === "brand")?.label).toBe("Brand brand-12 (registry unavailable)");
    expect(g(false).nodes.find((n) => n.kind === "brand")?.label).toBe("Unregistered brand brand-12");
  });
});

describe("clusterThreatIds", () => {
  it("sends each member's highest verdict, highest first", () => {
    const graph = buildGraph({
      ...base,
      threats: [threat("t1", "A", "brand-1", 60), threat("t1b", "A", "brand-2", 80), threat("t2", "B", "brand-2", 30)],
      related: new Map([["t1", [rel("t2", "B", "domain", "acme-help.example")]]]),
    });
    expect(clusterThreatIds(graph.clusters[0], graph.nodes)).toEqual(["t1b", "t2"]);
  });
});

describe("layoutGraph", () => {
  it("is deterministic", () => {
    const graph = buildGraph({ ...base, threats: [threat("t1", "A", "b", 60), threat("t2", "B", "b", 20)], related: new Map() });
    const a = layoutGraph(graph.nodes, graph.edges, 50);
    const b = layoutGraph(graph.nodes, graph.edges, 50);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});
