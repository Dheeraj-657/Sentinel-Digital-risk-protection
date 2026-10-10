# Module 2 — Integration Matrix

Per-dependency truth. Module 1 is now REAL (Sentinel DRP — teammate's
Next.js service, contract resolved 2026-10-09); Modules 3 and 4 do not
exist in this repository. Every touchpoint below is labeled exactly as
implemented. Nothing here is fabricated as production behavior.

## Module 1 — Brand Intelligence (REAL: Sentinel DRP — teammate's Next.js service)

| Touchpoint | Artifact | Status | Notes |
|---|---|---|---|
| Client protocol | `BrandDNAClient` (`integrations/module1/client.py`) | IMPLEMENTED (interface) | `get_brand_dna(brand_id) -> BrandDNA`; raises `MissingBrandDNAError` |
| HTTP adapter (proposed pin) | `HTTPBrandDNAClient` | IMPLEMENTED (adapter) | Kept as the CONTRACT_PROPOSED pin; no longer bound at startup |
| Real adapter | `SentinelBrandClient` (`integrations/module1/sentinel.py`) | IMPLEMENTED (adapter) | Bound when `TRUSTGRAPH_MODULE1_BASE_URL` set — upstream is EXTERNAL_DEPENDENCY |
| Real endpoint | `GET /api/brands` (list-only) | RESOLVED against Sentinel source | No per-brand GET, no `/dna`; selection by deterministic `uuid5` bridge (`sentinel_cuid_to_brand_uuid`); 404 on the list = route drift, not missing brand |
| Wire errors | 404→`MISSING_BRAND_DNA`(424); other non-200→`INTEGRATION_UNAVAILABLE("http_NNN")`(503); bad JSON→`invalid_json`; schema drift→`contract_mismatch`; `httpx.HTTPError`→`network_error` | IMPLEMENTED | Upstream bodies never leak (test-verified) |
| Mock | `MockBrandDNAClient` | MOCK | In-memory dict, `SYNTHETIC TEST/LDEV DATA ONLY` |
| BrandDNA DTO | `schemas/brand_dna.py` | RESOLVED (internal canonical) | Sentinel fields mapped onto it by `SentinelBrandClient`: officialDomains→domains+verified_domains, officialHandles→verified_social_handles; keywords NOT aliases (abuse vocabulary); version=constant (list payload has no updatedAt); visual/social/text anchors honestly empty |

## Module 3 — Digital Intelligence / Entity & Evidence (minimum viable service exists → REAL, sibling repo dir `module3/`)

| Touchpoint | Artifact | Status | Notes |
|---|---|---|---|
| Entity protocol | `EntityProvider.get_entity(tenant_id, entity_id)` | IMPLEMENTED (interface) | |
| Evidence protocol | `EvidenceProvider.list_evidence(tenant_id, entity_id)` | IMPLEMENTED (interface) | |
| HTTP adapter | `HTTPModule3Client` (implements both) | IMPLEMENTED (adapter) | Forwards `X-Tenant-ID`; bind via `TRUSTGRAPH_MODULE3_BASE_URL` (e.g. `http://localhost:8001`) |
| Endpoints assumed | `GET /api/v1/entities/{entity_id}`, `GET /api/v1/entities/{entity_id}/evidence` | RESOLVED against `module3/` service | Bare JSON list for evidence, ordered by (collected_at, evidence_id); plus ingestion surface `POST /sources`, `POST /entities`, `POST /entities/{id}/evidence`; all require UUID `X-Tenant-ID` (400 TENANT_REQUIRED) |
| Wire errors | 403/404→`INVALID_ENTITY`(404, indistinguishable); other→`INTEGRATION_UNAVAILABLE`; bad JSON/drift→typed reasons | IMPLEMENTED | Test-verified; module3 returns 404 for missing OR cross-tenant so Module 2's mapping holds |
| Wire-format parity gate | `module3/tests/test_contract_parity.py` | IMPLEMENTED (test-time only) | Validates module3's actual HTTP JSON against `app.schemas.entity` models when both packages share the venv; no runtime coupling |
| Mocks | `MockEntityProvider`, `MockEvidenceProvider` | MOCK | Synthetic only; replaced at runtime when base URL set |
| EntityReference DTO | `schemas/entity.py` | RESOLVED (matches module3) | entity_id, tenant_id, entity_type, display_name, identifiers{}, attributes{} |
| EvidenceReference DTO | `schemas/entity.py` | RESOLVED (matches module3) | evidence_id, source_id, entity_id, evidence_type, collected_at, text?, image_hash?, url?, metadata{} — the metadata keys Module 2 reads: `days_since_registration`, `whois_privacy`, `recent_account_creation`, `high_post_frequency`, `brand_mimicry_in_bio`, `blocklisted`, `abuse_reports`, `linked_to_known_threat`, `shared_identifiers` |
| Fixture seeding | `python -m module3.seed <tenant-uuid>` | IMPLEMENTED | Idempotent (uuid5 ids); every record labelled `SYNTHETIC TEST_ONLY`; no live discovery results invented |
| Persistence of M3 data | none | IMPLEMENTED (by omission) | References only (`analysis_evidence_references`); no copies of aggregates |

## Module 4 — Investigation / Threat Graph (does not exist → consumes us)

| Touchpoint | Artifact | Status | Notes |
|---|---|---|---|
| Threat read API | `GET /api/v1/threats`, `GET /api/v1/threats/{id}` | IMPLEMENTED | Full explainability payload; stable contract |
| Lifecycle API | `PATCH /api/v1/threats/{id}/status` | IMPLEMENTED | OPEN⇄CONFIRMED, OPEN⇄DISMISSED; 409 on direct CONFIRMED↔DISMISSED |
| Events | `threat.created`, `risk.recalculated`, `threat.status_changed` | IMPLEMENTED (schemas) | Delivery transport depends on publisher binding (log now; broker EXTERNAL_DEPENDENCY) |
| Boundary notes | `integrations/module4/__init__.py` | IMPLEMENTED (notes only) | No adapter needed in this direction |

## Platform dependencies

| Dependency | Status | Notes |
|---|---|---|
| FastAPI / Pydantic v2 / SQLAlchemy 2.x / Alembic / httpx | IMPLEMENTED (pinned ≥ in pyproject) | Core stack |
| SQLite | IMPLEMENTED (default `database_url`) | Dev/test |
| PostgreSQL | EXTERNAL_DEPENDENCY | Recommended production target; migrations are portable; not exercised here (no server in repo) |
| scikit-learn | EXTERNAL_DEPENDENCY (optional extra `[ml]`) | Only for `sklearn_tfidf`; absent → registry raises `ModelUnavailableError` at startup, never mid-analysis |
| sentence-transformers | EXTERNAL_DEPENDENCY (deliberately not bundled) | Commented extra; embedding models land behind the text protocol |
| Broker (Kafka/RabbitMQ) for events | EXTERNAL_DEPENDENCY | Implement `EventPublisher` |
| Broker/queue for durable jobs | EXTERNAL_DEPENDENCY | Implement `AnalysisJobQueue` (4 methods) |
| Auth/identity provider | TBD | Module 2 uses `X-Tenant-ID` until the platform provides real auth; single dependency to replace (`get_tenant`) |
| Scraping/ingestion, notifications | OUT OF SCOPE | Owned by other modules; never implemented here |

## Mock-mode wiring summary

| Setting state | brand_client | entity/evidence providers | Deployment meaning |
|---|---|---|---|
| both base URLs set | `SentinelBrandClient` | `HTTPModule3Client` | Real integration (Module 1 = Sentinel DRP; Module 3 = Phase 2 service) |
| either unset | `MockBrandDNAClient` / mocks | mocks | Contract/dev environment; `mock_integrations: true` logged |
