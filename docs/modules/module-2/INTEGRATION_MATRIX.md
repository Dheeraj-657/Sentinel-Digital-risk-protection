# Module 2 — Integration Matrix

Per-dependency truth. Modules 1, 3, 4 DO NOT EXIST in this repository; every
touchpoint below is labeled exactly as implemented. Nothing here is
fabricated as production behavior.

## Module 1 — Brand Intelligence (does not exist → CONTRACT_ONLY)

| Touchpoint | Artifact | Status | Notes |
|---|---|---|---|
| Client protocol | `BrandDNAClient` (`integrations/module1/client.py`) | IMPLEMENTED (interface) | `get_brand_dna(brand_id) -> BrandDNA`; raises `MissingBrandDNAError` |
| HTTP adapter | `HTTPBrandDNAClient` | IMPLEMENTED (adapter) | Bound only when `TRUSTGRAPH_MODULE1_BASE_URL` set — upstream is EXTERNAL_DEPENDENCY |
| Endpoint assumed | `GET /api/v1/brands/{brand_id}/dna` | CONTRACT_PROPOSED | Chosen by Module 2; real Module 1 contract wins |
| Wire errors | 404→`MISSING_BRAND_DNA`(424); other non-200→`INTEGRATION_UNAVAILABLE("http_NNN")`(503); bad JSON→`invalid_json`; schema drift→`contract_mismatch`; `httpx.HTTPError`→`network_error` | IMPLEMENTED | Upstream bodies never leak (test-verified) |
| Mock | `MockBrandDNAClient` | MOCK | In-memory dict, `SYNTHETIC TEST/LDEV DATA ONLY` |
| BrandDNA DTO | `schemas/brand_dna.py` | CONTRACT_PROPOSED | Minimal fields Module 2 needs: identity(name/aliases), domains, social_profiles, visual_assets(content_hash), text_signals, verification(verified_domains/handles), version |

## Module 3 — Digital Intelligence / Entity & Evidence (does not exist → CONTRACT_ONLY)

| Touchpoint | Artifact | Status | Notes |
|---|---|---|---|
| Entity protocol | `EntityProvider.get_entity(tenant_id, entity_id)` | IMPLEMENTED (interface) | |
| Evidence protocol | `EvidenceProvider.list_evidence(tenant_id, entity_id)` | IMPLEMENTED (interface) | |
| HTTP adapter | `HTTPModule3Client` (implements both) | IMPLEMENTED (adapter) | Forwards `X-Tenant-ID`; upstream EXTERNAL_DEPENDENCY |
| Endpoints assumed | `GET /api/v1/entities/{entity_id}`, `GET /api/v1/entities/{entity_id}/evidence` | CONTRACT_PROPOSED | |
| Wire errors | 403/404→`INVALID_ENTITY`(404, indistinguishable); other→`INTEGRATION_UNAVAILABLE`; bad JSON/drift→typed reasons | IMPLEMENTED | Test-verified |
| Mocks | `MockEntityProvider`, `MockEvidenceProvider` | MOCK | Synthetic only |
| EntityReference DTO | `schemas/entity.py` | CONTRACT_PROPOSED | entity_id, tenant_id, entity_type, display_name, identifiers{}, attributes{} |
| EvidenceReference DTO | `schemas/entity.py` | CONTRACT_PROPOSED | evidence_id, source_id, entity_id, evidence_type, collected_at, text?, image_hash?, url?, metadata{} — the metadata keys Module 2 reads: `days_since_registration`, `whois_privacy`, `recent_account_creation`, `high_post_frequency`, `brand_mimicry_in_bio`, `blocklisted`, `abuse_reports`, `linked_to_known_threat`, `shared_identifiers` |
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
| both base URLs set | `HTTPBrandDNAClient` | `HTTPModule3Client` | Real integration (requires the modules to exist) |
| either unset | `MockBrandDNAClient` / mocks | mocks | Contract/dev environment; `mock_integrations: true` logged |
