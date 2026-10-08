# Module 2 — Integration Conflict Analysis

Doc status: PARTIAL — forward-looking analysis of CONTRACT_PROPOSED surfaces.
Last updated: 2026-10-08 (against engine `1.0.0`, service `1.0.0`).

Status labels follow the legend in [README.md](README.md): `IMPLEMENTED`,
`CONTRACT_ONLY`, `CONTRACT_PROPOSED`, `MOCK`, `TBD`, `EXTERNAL_DEPENDENCY`.

---

## 1. Purpose and method

Module 2 defines **proposed** contracts toward Modules 1 and 3 and **exposes**
a contract toward Module 4. None of those modules exist in this repository.
This document inventories every surface where a future real implementation can
disagree with Module 2's assumptions, rates each conflict, and states the
agreed resolution direction (`app/schemas/brand_dna.py:3-8` records the policy:
*when Module 1 ships, ITS actual contract wins and this schema is adapted*).

Method: each conflict is stated as

- **Module 2 assumption** — what the code assumes today (with file references),
- **Likely divergence** — how a real module could plausibly differ,
- **Severity** — impact if unresolved (HIGH = wrong risk scores or broken
  analysis; MEDIUM = degraded behavior or rework; LOW = friction only),
- **Detection** — how the conflict surfaces when it happens,
- **Resolution direction** — which side adapts and how.

Nothing here is resolved against real modules (they do not exist); all items
remain **open** until the counterpart module ships and the contract is
re-validated against its actual implementation.

---

## 2. Contract surfaces inventory

| # | Surface | Defined in | Direction | Status |
|---|---------|-----------|-----------|--------|
| S1 | BrandDNA aggregate (identity, domains, social profiles, visual hashes, text signals, verification) | `app/schemas/brand_dna.py` | Module 2 ← Module 1 | CONTRACT_PROPOSED |
| S2 | Brand DNA retrieval path `/api/v1/brands/{brand_id}/dna` | `app/integrations/module1/client.py` (`BRAND_DNA_PATH`) | Module 2 ← Module 1 | CONTRACT_PROPOSED |
| S3 | EntityReference (normalized entity view) | `app/schemas/entity.py` | Module 2 ← Module 3 | CONTRACT_PROPOSED |
| S4 | EvidenceReference (scored content + metadata) | `app/schemas/entity.py` | Module 2 ← Module 3 | CONTRACT_PROPOSED |
| S5 | Entity/evidence retrieval paths `/api/v1/entities/{entity_id}` and `/api/v1/entities/{entity_id}/evidence` | `app/integrations/module3/providers.py` (`ENTITY_PATH`, `ENTITY_EVIDENCE_PATH`) | Module 2 ← Module 3 | CONTRACT_PROPOSED |
| S6 | Evidence metadata keys (9 keys listed in [API_CONTRACT.md](API_CONTRACT.md)) | `app/services/signal_extraction.py` | Module 2 ← Module 3 | CONTRACT_PROPOSED |
| S7 | Tenant propagation header `X-Tenant-ID` | `app/integrations/module3/providers.py`, `app/api/deps.py` | bidirectional | CONTRACT_PROPOSED |
| S8 | Event envelope `{"metadata", "data"}` + 6 event types | `app/events/schemas.py` | Module 2 → Module 4 | IMPLEMENTED (schema) / TBD (transport) |
| S9 | Threat lifecycle + status transitions (`POST /threats/{id}/status`) | `app/api/v1/threats.py` | Module 2 → Module 4 | IMPLEMENTED |
| S10 | Risk factor records (factor-level explainability) | `app/models/analysis.py` | Module 2 → Module 4 | IMPLEMENTED |

---

## 3. Conflict register

| ID | Area | Module 2 assumption | Likely divergence | Severity | Detection | Resolution direction |
|----|------|--------------------|-------------------|----------|-----------|---------------------|
| C-01 | BrandDNA shape (S1) | Frozen nested model; `brand_id: UUID`; `version: str`; visual anchors as perceptual-hash hex strings; no raw assets | Module 1 may key brands by slug/int, embed assets by URL, or lack a version field | HIGH | `EntityReference`-style `model_validate` failure → `IntegrationUnavailableError("module1", "contract_mismatch")`; analysis jobs fail CLOSED | Module 1 wins; add adapter in `app/integrations/module1` that maps their model → `BrandDNA`. Module 2 pipeline code must not change |
| C-02 | Brand DNA path (S2) | GET `/api/v1/brands/{brand_id}/dna` returns 200 with BrandDNA; 404 → `MissingBrandDNAError` | Different path, versioned prefix (`/v2/`), or batch endpoint | MEDIUM | 404 on a brand that exists under Module 1's real path → `MissingBrandDNAError` (424) on every analysis | Path lives in one constant (`BRAND_DNA_PATH`); re-point it, add adapter if the payload differs |
| C-03 | Entity/evidence paths (S3–S5) | Single-entity GET + evidence list per entity; `tenant_id` present in EntityReference body AND sent as `X-Tenant-ID` header | Module 3 may expose search-first APIs, cursor-paginated evidence, or tenant only via token claims | MEDIUM | `InvalidEntityError` (404-mapped) or `contract_mismatch` for valid entities | Constants `ENTITY_PATH` / `ENTITY_EVIDENCE_PATH` are single points of change; adapter maps payloads |
| C-04 | Evidence metadata keys (S6) | Exact string keys: `days_since_registration`, `whois_privacy`, `recent_account_creation`, `high_post_frequency`, `brand_mimicry_in_bio`, `blocklisted`, `abuse_reports`, `linked_to_known_threat`, `shared_identifiers` | Module 3 uses different names, nesting (`meta.whois.days`), or richer enums instead of booleans | HIGH | Silent: unknown keys are ignored (`metadata.get(...)` returns None) → factors silently omit evidence, risk score drops with no error | Highest-priority conflict. Mitigation today: factors without evidence are omitted (never zero-filled), so a total drop is visible. Resolution: contract test suite against real Module 3 + an explicit "unrecognized-metadata" observability counter (TBD) |
| C-05 | Tenant header (S7) | `X-Tenant-ID: <uuid>` forwarded downstream; 403 and 404 both mapped to `InvalidEntityError` | Platform standard is OAuth claim / mTLS identity, not a header; downstream may treat header as untrusted | HIGH | If downstream ignores the header and returns other tenants' data, Module 2 cannot detect it — scores would be computed on cross-tenant entities | Module 2 forwards whatever tenant identity the platform authenticates (single tenant system — `app/api/deps.py` parses the same header for inbound). When real auth lands, replace header parsing in ONE place (`get_tenant`) and downstream header injection in the two HTTP clients |
| C-06 | Tenant identity format | `tenant_id: str` throughout Module 2's own tables; `UUID` in Module 3 DTOs | Platform tenant ids may not be UUIDs | LOW | Pydantic validation error on Module 3 responses only if formats differ | Normalize in adapters; Module 2 internal storage stays opaque string |
| C-07 | Threat lifecycle ownership (S9) | Module 2 owns threat creation and the 4-state machine; Module 4 consumes read-only + transitions via API | Module 4's investigation workflow will need richer states (in-review, escalated, merged) or bidirectional sync with its own graph store | MEDIUM | Module 4 hits 409 `INVALID_STATUS_TRANSITION` for transitions Module 2 forbids (`CONFIRMED`↔`DISMISSED`); duplicated threat state in Module 4's graph | Module 2 remains system of record for status. Additions to `ThreatStatus` require a migration + event-schema review; direct transitions stay forbidden unless Module 4 justifies them |
| C-08 | Event transport (S8) | `EventPublisher` Protocol with `InMemoryEventPublisher` (MOCK) and `LoggingEventPublisher` (IMPLEMENTED); no broker | Module 4 expects durable delivery (Kafka/AMQP/Outbox); logging publisher is fire-and-forget, at-most-once | HIGH | Module 4 misses `threat.created` / `risk.recalculated` events entirely with no error anywhere | Documented TBD. Resolution: implement an outbox-table publisher inside Module 2's existing transaction boundary, then a broker adapter; keep the Protocol unchanged |
| C-09 | Event schema stability (S8) | `event_version: "1.0"`, fixed 6 event types, payloads nested under `data` | Module 4 requests new fields (e.g., top factor summary on `risk.recalculated`) or additional event types | LOW | Unknown fields are dropped by Pydantic consumers; missing fields break Module 4 parsers | Additive changes bump minor version (`1.1`) with new optional fields; breaking changes bump major and are published in [EVENTS.md](EVENTS.md) before Module 4 builds on them |
| C-10 | Idempotency ownership | Module 2 persists its own `idempotency_records` table (24 h TTL, tenant-scoped sha256 of canonical JSON) | Platform-level idempotency middleware or gateway already deduplicates by key | LOW | Duplicate storage; divergent replay semantics (gateway replays cached 202 vs Module 2 returns stored job) | If a platform mechanism exists and is authoritative, Module 2's table becomes a local cache; keep tenant-scoping, drop nothing until platform behavior is verified |
| C-11 | Evidence retention vs explainability (S4, S10) | Risk factors persist `evidence_ids` citing Module 3 evidence indefinitely; results are reproducible | Module 3 evidence may be deleted (retention policy, right-to-erasure) leaving Module 2 factors citing unresolvable evidence | HIGH | Legal/compliance conflict: Module 2's explainability contract requires evidence traceability; Module 3 deletion breaks it. No runtime error today — the citation simply dangles | Explicit policy needed (open). Options: Module 3 emits tombstones Module 2 records on next recalculation; or Module 2 stores only evidence hashes/ref keys, never claiming live resolvability. Current doc stance: `EvidenceReference` citations are point-in-time, not liveness guarantees |
| C-12 | Risk configuration ownership | Weights/thresholds centralized in `app/risk/config.py`, single global config, versioned `ENGINE_VERSION` | Tenants (or Module 4 UIs) will ask for per-tenant tuning of weights/thresholds | MEDIUM | "Why is this brand scored differently" support load; Module 4 building shadow scoring to compensate | Refusal by default: per-tenant weights break cross-tenant score comparability, which is a stated product goal. If ever added, it must be config-versioned per analysis, not mutable globals |
| C-13 | Classification taxonomy | Fixed 4-value `ThreatClassification` (`PHISHING`, `BRAND_IMPERSONATION`, `SUSPICIOUS_DOMAIN`, `UNKNOWN`) with a priority ladder | Module 4 graph/taxonomy expects a richer or externally-defined label set | MEDIUM | Module 4 maps Module 2 labels onto its own ontology at read time — silent fidelity loss | Module 2 publishes the ladder + thresholds ([RISK_ENGINE.md](RISK_ENGINE.md)); if Module 4 needs more classes, that is a config+enum change with tests, not a per-response mapping hack |
| C-14 | Queue semantics | `SyncJobQueue` / `InProcessJobQueue`, at-most-once in-process; no redelivery | Platform standard is a durable queue with at-least-once redelivery | MEDIUM | Duplicate executions of the same job id after crash-redelivery | AnalysisExecutor is already idempotent per job (status guards + idempotent upsert of threats by `(tenant, brand, entity)`); verify upsert path under redelivery before swapping the queue |
| C-15 | Error-mapping semantics | Downstream 403 and 404 uniformly → `InvalidEntityError` (existence indistinguishable from cross-tenant access); non-JSON / shape drift → `IntegrationUnavailableError` | Module 1/3 want distinct client-visible semantics (e.g., 404 "brand not onboarded" is an expected user flow, not an error) | LOW | Support friction: consumers cannot tell "missing brand" from "wrong tenant" by design | Keep the uniform mapping (security-motivated); expose `MissingBrandDNAError` (424) for the expected Module 1 onboarding gap, as already implemented |
| C-16 | Body/size limits | `max_request_body_bytes = 65_536`; analysis requests carry only ids | Module 4 or gateway may batch large evidence payloads through Module 2 | LOW | 413 on legitimate batch requests | Module 2 accepts ids only by contract; batches go through Module 3, not through Module 2 request bodies |

---

## 4. Highest-priority conflicts (detail)

### C-04 — Evidence metadata key names (silent degradation)

The only conflict that can silently change risk scores without any error
signal. Extraction reads metadata with `.get()` and returns `None` when a key
is absent (`app/services/signal_extraction.py`), and the risk engine omits
factors without evidence. A renamed Module 3 key therefore lowers scores
across the board.

- **Current mitigation**: score-total drop is visible in `risk.recalculated`
  events and per-factor records; but nothing alerts on *why*.
- **Required before Module 3 go-live**: a contract test suite asserting every
  key in [API_CONTRACT.md](API_CONTRACT.md) §evidence-metadata is present in
  Module 3's real payload fixtures, plus a counter for evidence items whose
  `evidence_type` is known but whose expected metadata keys are all absent.
- **Owner when resolved**: Module 3 owns key names; Module 2 owns the adapter
  mapping their names to extraction inputs.

### C-05 — Tenant propagation (security-critical)

Module 2's inbound tenant resolution (`X-Tenant-ID`, required, validated in
`app/api/deps.py`) and outbound forwarding (the two HTTP clients) are both
provisional. A real deployment replaces the header with the platform's
authenticated identity. The rule recorded in [SECURITY.md](SECURITY.md) holds
either way: **there is exactly one tenant mechanism**, and both sides of every
hop must derive from it. Any future change lands in exactly two places:
`get_tenant` (inbound) and the client `headers=` construction (outbound).

### C-07 — Threat lifecycle ownership

Module 2 owns threat identity — including the natural key
`uq_threat_tenant_brand_entity` that makes re-analysis update-in-place rather
than spawn duplicates — and the transition matrix. Module 4's investigation
workflow is a *consumer*. The conflict to watch: Module 4 duplicating threat
state into its graph and then editing it there. The contract answer is that
Module 4 stores references (threat_id) and its own annotations, and performs
state changes only via `POST /api/v1/threats/{threat_id}/status`, which emits
the corresponding events.

### C-08 — Event transport

The 6-event schema is IMPLEMENTED and stable; transport is not. Today's
`LoggingEventPublisher` is at-most-once to whoever greps logs. A durable
Module 4 integration requires an outbox pattern (event rows committed in the
same transaction as the state change, relayed to a broker). The seam already
exists — `EventPublisher` Protocol — so this is additive work with no changes
to publishers' consumers.

### C-11 — Evidence retention vs explainability

Irreducible tension: explainability requires citing evidence; retention law
may require deleting it. Module 2's current, honest position: `evidence_ids`
on factors and `threat.evidence_references` are **point-in-time citations**,
not liveness guarantees. If compliance requires tombstoning, it is a new
contract item for Module 3 (`evidence.revoked` event or similar), not
something Module 2 can satisfy alone.

---

## 5. Accepted frictions (no action planned)

- **403/404 uniformity (C-15)** — deliberate; documented in both client
  docstrings.
- **Internal-only evidence storage** — Module 2 persists `evidence_references`
  rows (ref keys + metadata snapshot) purely to honor the explainability
  contract; this is reference storage, not duplication of Module 3 aggregates.
  If Module 3 objects even to reference keys, the fallback is hashing refs —
  to be negotiated, not pre-implemented.
- **`contract_mismatch` fails analysis closed** — a real module shipping a
  payload Module 2 cannot parse stops analysis for that entity rather than
  producing ungoverned scores. This is the intended behavior and stays.

---

## 6. Resolution governance

1. **The real module's contract wins.** Adaptation happens in
   `app/integrations/module{1,3}` adapters; pipeline, risk engine, and API
   layers never learn downstream shapes (enforced by the layering in
   [ARCHITECTURE.md](ARCHITECTURE.md)).
2. **Every resolution updates this document** — the conflict moves from
   *open* to *resolved-against-<module version>* with the adapter commit.
3. **Contract tests are the gate.** Before enabling a real base URL
   (`module1_base_url` / `module3_base_url`), the adapter must pass a fixture
   suite built from the real module's payload samples — not from Module 2's
   guesses.
4. **Versioning rules**: S8 events follow the minor/major policy in C-09; S1
   and S4 payloads are matched with tolerant adapters (`model_validate`) and
   never with hand-rolled parsers.
5. **Nothing in this document is verified against real modules** — Modules 1,
   3, and 4 do not exist in this repository. All items remain open.
