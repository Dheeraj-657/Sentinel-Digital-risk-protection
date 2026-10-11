# TRUSTGRAPH — Feature Completeness Audit

**Audit date:** 2026-10-10
**Method:** Full source read of all four modules — `module1/` (Sentinel), `backend/` (Module 2 risk engine), `module3/` (entity/evidence/source service), `frontend/` (TRUSTGRAPH console) — with file:line evidence, cross-checked against `docs/API.md`, all test suites (frontend 29 vitest, M2 113 pytest, M3 71 pytest, M1 `npm run test:engine`), production build records, and the 2026-10-09 browser E2E (M2 job `cc26e681` → threat `3c4011c5`; 90 network requests, all 200/304/202, console clean).

**Scope note — console vs module-native UI.** Module 1 ships its own Next.js UI on :3000 (`/`, `/brands`, `/scan`, `/scans/[id]`, `/history`). The TRUSTGRAPH console (`frontend/`, :5173) is the integrated product surface this audit judges. A feature that exists only in the module-native UI and not the console is listed as **Partial** with that noted.

**Prior results are treated as evidence, not proof.** Recorded test/E2E outcomes were re-checked against current source; where no automated test or browser evidence exists for a row, the row says so.

## Status legend

| Status | Meaning |
|---|---|
| **Verified** | Implemented and verified (automated test and/or browser E2E evidence) |
| **Not verified** | Implemented but not verified (no automated test or browser evidence) |
| **Partial** | Partially implemented (gap documented in the row) |
| **Missing** | Missing (no implementation in module or console) |
| **Blocked** | Blocked by an API, provider, or external dependency |

## Module 1 — Sentinel (Brand Intelligence, :3000)

| Feature | Status | Backend | Console | Data source | Verification | Limitation |
|---|---|---|---|---|---|---|
| Brand listing | Verified | `GET /api/brands` (demo-first; `{items}` with id/isDemo/scanCount) | `/brands`, `/brands/:brandId`, Dashboard | M1 SQLite (Prisma) | Console E2E 2026-10-09 | None |
| Brand detail view | Verified | None — client-side locate from list (no `GET /api/brands/[id]` in M1) | `/brands/:brandId` | M1 SQLite | Console E2E | Detail assembled client-side; no single-brand GET |
| Brand creation | Partial | `POST /api/brands` (Zod `brandInputSchema` `src/lib/engine/entity.ts:8-23`; 409 `BRAND_EXISTS`; normalization strips scheme/path/www/@, lowercases) | **Missing** — Brands page is read-only by design (`frontend/src/pages/Brands.tsx:8-9`); only M1-native `/brands` has a form | M1 SQLite | None — no route test in M1 | Console form missing |
| Brand editing | Missing | No `PATCH`/`PUT /api/brands/[id]` anywhere in M1 | None | — | — | Requires a new additive M1 endpoint |
| Brand deletion | Partial | `DELETE /api/brands/[id]` (404 `NOT_FOUND`, 400 `DEMO_BRAND`, 204; scans.brandId → SetNull) | **Missing** in console; M1-native UI has delete | M1 SQLite | None | Console action missing |
| Brand DNA display | Verified | Brand record fields: officialDomains, officialHandles, appDevelopers, packagePrefixes, keywords | BrandDetail | M1 SQLite | Console E2E | Display only; no edit (see editing row) |
| Brand validation & normalization | Not verified | Zod schema + normalization (name 2-80; list fields ≤20; domain/handle cleanup) | Console forms depend on it | — | Only engine parts covered by `npm run test:engine`; route-level validation untested | No API route tests in M1 |
| Scan creation | Partial | `POST /api/scans` (rate limit 12/min → 429 + retryAfterSec; entityType PROFILE/WEBSITE/DOMAIN/APP; input 3-2048; claimedDeveloper ≤120; brandId or ad-hoc brand; 201 AnalysisReport) | **Missing** — M1-native `/scan` only | M1 SQLite + intel providers | Engine pipeline covered by engine-check; route untested | Console NewScan page missing |
| Scan listing / history | Partial | `GET /api/scans` (type/level/q ≤200/target ≤300/limit 1-100/cursor; `{items,nextCursor,total}`) | **Missing** — M1-native `/history` only (debounced search, cursor pagination) | M1 SQLite | None | Console page missing |
| Scan detail / results | Partial | `GET /api/scans/[id]` (`{report, history}` incl. up to 12 same-target earlier scans) | **Missing** — M1-native `/scans/[id]` only (full report, Re-scan, Export JSON, Delete, risk-over-time SVG) | M1 SQLite | None | Console page missing |
| Scan deletion | Partial | `DELETE /api/scans/[id]` | **Missing** — M1-native only | M1 SQLite | None | Console action missing |
| Risk scoring pipeline | Verified | 7-stage pipeline; 7 category caps sum 100; ~45 rules; levels 0-20 VERY_LOW … 81+ CRITICAL | Feeds M2 via SentinelBrandClient | In-process | `npm run test:engine` | None |
| Confidence scoring | Verified | 5-97; coverage 40 / independence 25 / reliability 20 / brand-ref 15 / conflict −10 | Scan report fields | In-process | `npm run test:engine` | None |
| Demo intelligence mode | Verified | Curated dataset; `NO_DATA` never fabricated; signal origin COMPUTED/LIVE/DEMO | Default `INTEL_MODE=demo` | Fixtures | engine-check + console E2E | Fixtures labelled per master-prompt rules |
| Live intelligence | Not verified | LIVE mode: rdap.org RDAP, DNS MX, HTTP redirect tracer with SSRF guard; certIssuer/certAgeDays/logoSimilarity null in live mode | Off by default | External network | No live-mode automated test | **Partially Blocked** — reputation/social/app intel still demo in live mode (vendor adapters absent) |
| Groq AI assessment | Partial | GROQ_API_KEY-gated (openai/gpt-oss-120b, temp 0.2, json_object, 20s, 3 attempts); deterministic fallback otherwise; grounding rejects invented numbers | `/api/health` reports `ai.configured: false` | Groq API | Fallback path verified via engine-check + E2E | **Blocked** — live path needs GROQ_API_KEY |
| Rate limiting | Not verified | 12/min token bucket, in-process, 429 + retryAfterSec | — | In-process | No automated test | In-process limiter (not distributed) |
| Stats aggregation | Partial | `GET /api/stats` (total, levels, byType, avgRisk, avgConfidence, recentHigh ≤6, recent 8, topSignals 5) | **Unused** — console Dashboard computes client-side counts | M1 SQLite | None | Console wiring missing |
| Health endpoint | Verified | `GET /api/health` (status, database, intelMode, ai, providers) | ServiceStatus | — | Console E2E | None |

## Module 2 — AI Threat Detection & Risk Engine (:8000, canonical, frozen at tag `module-2-freeze`)

| Feature | Status | Backend | Console | Data source | Verification | Limitation |
|---|---|---|---|---|---|---|
| Create analysis | Verified | `POST /api/v1/analysis` ({brand_id, entity_id} → 202; 200 replay/sync; echoes Idempotency-Key) | `/analysis/new` | M2 SQLite + M1 DNA + M3 entity/evidence | test_api/test_contracts + console E2E | None |
| Job progress / polling | Verified | `GET /api/v1/analysis/{job_id}` (QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED) | `/analysis/:jobId` (1.5s poll, 120s timeout, stops on terminal states) | M2 SQLite | Tests + console E2E | CANCELLED state unreachable (no cancel op) |
| Job error display | Verified | error_code/message/details/correlation_id in job payload | FAILED state + Retry recovery | M2 SQLite | test_api | Real-failure browser E2E pending (Phase 6) |
| Past jobs / analysis history | **Missing** | `JobService.list_for_tenant` exists (`app/services/jobs.py:35-59`) but **no route exposes it** | None | — | — | Requires additive `GET /api/v1/analysis` (service already implemented) |
| Threat listing | Verified | `GET /api/v1/threats` (status, risk_level, limit 1-200 default 50, offset; risk_score DESC) | `/threats` | M2 SQLite | test_api + E2E | Console ignores server offset (client pagination) |
| Threat search / filter / sort / paginate | Partial | Server filters: status, risk_level only | Client search (IDs/classification), 2 sorts, 25-page client pagination (`PAGE_SIZE` threats.tsx:11) | M2 SQLite | Console E2E | Search/sort are client-side; threats beyond limit 200 invisible; server offset unused |
| Threat detail | Verified | `GET /api/v1/threats/{id}` (evidence_references from latest AnalysisResult) | `/threats/:threatId` | M2 SQLite | test_api + E2E | None |
| Risk score / severity / classification / confidence | Verified | Threat model fields; classifier priority PHISHING → BRAND_IMPERSONATION → SUSPICIOUS_DOMAIN → UNKNOWN; thresholds 25/50/75 | Threat cards + detail | M2 SQLite | test_risk_engine (22) + E2E | None |
| Factor contributions & basis | Verified | 7 factor types; weights IDENTITY .20 / TEXT .15 / VISUAL .20 / DOMAIN .15 / BEHAVIORAL .10 / REPUTATION .10 / RELATIONSHIP .10; basis OBSERVED/DERIVED/INFERRED; contribution = score × weight | ThreatDetail factor breakdown with basis badges | M2 SQLite | test_risk_engine + E2E | Factor-weight sentence hardcoded as display copy (`ThreatDetail.tsx:200-204`) |
| Evidence references & provenance | Verified | evidence_references (real M3 evidence ids) | EvidencePanel joins M3 evidence + sources | M2+M3 SQLite | Console E2E | Provenance limited to SYNTHETIC fixtures in demo mode |
| Analyst status transitions | Verified | `PATCH /api/v1/threats/{id}/status` (OPEN→CONFIRMED/DISMISSED, CONFIRMED/DISMISSED→OPEN; direct CONFIRMED↔DISMISSED → 409; audit log + event) | ThreatDetail Confirm/Dismiss/Reopen buttons | M2 SQLite | test_api (transitions incl. 409 path) | Browser persistence re-verified in Phase 6 |
| Recommended investigation actions | Verified | M1 scan recommendedActions; static investigation playbook | ThreatDetail | M1+M2 | Console E2E | Playbook static by design |
| Re-run analysis & idempotency | Verified | Same key + same fingerprint → replay; different fingerprint → 409; re-run upserts same (tenant, brand, entity) threat, replaces factors wholesale, appends immutable AnalysisResult, keeps analyst status | ThreatDetail Re-run deep-link | M2 SQLite | test_jobs_idempotency (10) + E2E re-analysis | None |
| Explainability (why this result) | Verified | Factor basis + evidence ids per factor | Why-this-score narrative + basis badges distinguish observed facts from inference | M2 SQLite | test_risk_engine + E2E | None |
| Tenant isolation | Verified | X-Tenant-ID required (`deps.py`); cross-tenant access deliberately 404 | TenantControl | M2 SQLite | M2 + M3 test suites | None |
| Health / readiness / metrics | Verified | `/healthz`, `/readyz` (503 unready), `/metrics` | ServiceStatus | — | Console E2E | None |
| ML similarity models | Verified | CharNGramTextSimilarity, PhashHammingVisualSimilarity, TokenIdentitySimilarity — all three used in scoring | — | In-process | test_ml_models (19) | None |
| Observability & error envelope | Verified | 6 event types; `{error_code, message, details, correlation_id}`; 500 generic, no stack traces | — | — | test_contracts (20) | None |

## Module 3 — Entity / Evidence / Source Service (:8001)

| Feature | Status | Backend | Console | Data source | Verification | Limitation |
|---|---|---|---|---|---|---|
| Entity registration | Verified | `POST /api/v1/entities` (client entity_id honored; 409 `DUPLICATE_ENTITY` on exact id reuse; entity_type enum; display_name ≤300; identifiers normalized) | `/entities` RegisterEntityCard | M3 SQLite | test_api (27) + console E2E (threat `3c4011c5` flow) | None |
| Entity listing | Verified | `GET /api/v1/entities` (limit 1-200 default 50, offset, newest-first) | `/entities` (fetch limit 200) | M3 SQLite | test_list_endpoints (13) | No filters (see search row) |
| Entity detail | Verified | `GET /api/v1/entities/{id}` | `/entities/:entityId` | M3 SQLite | test_api + E2E | None |
| Entity updating | **Missing** | No PATCH/PUT | None | — | — | Requires additive M3 endpoint |
| Entity deletion | Missing | No DELETE | None | — | — | Future work (spec asks update where supported; deletion not required) |
| Entity search / filter | **Missing** | No query params on list | Console lists all (limit 200) | M3 SQLite | test_list_endpoints asserts current no-filter behavior | Entities beyond 200 invisible |
| Identifier / attribute normalization | Verified | normalize_domain / normalize_handle / normalize_identifiers | On create | — | test_normalization (23) | None |
| Deduplication on natural keys | **Missing** | Only exact entity_id → 409; same domain registered twice creates two entities | — | — | test_api asserts duplicate-id 409 only | Same logical entity can be registered multiple times |
| Source creation | Partial | `POST /api/v1/sources` (name 1-200, kind 1-100) | Inline creation only; kind hardcoded `"fixture"` (`EntityDetail.tsx:317`); no dedicated Sources page | M3 SQLite | test_api | Console form limited |
| Source listing | Partial | `GET /api/v1/sources` (paginated) | No dedicated page; consumed via EvidencePanel join | M3 SQLite | test_list_endpoints | Console page missing |
| Evidence creation | Verified | `POST /api/v1/entities/{id}/evidence` (source_id + evidence_type required; collected_at defaults utcnow; text/image_hash/url/metadata optional; entity 404; source 404 `SOURCE_NOT_FOUND`) | EntityDetail attach-evidence form | M3 SQLite | test_api + console E2E | None |
| Evidence listing / timeline | Verified | `GET /api/v1/entities/{id}/evidence` (bare JSON list, collected_at ASC) | EntityDetail evidence timeline | M3 SQLite | test_api + E2E | No pagination |
| Entity-to-threat / evidence-to-threat links | Verified | M2 threat evidence_references use real M3 evidence ids; entity deep-links from threats | ThreatDetail EvidencePanel + Investigate entity | M2+M3 SQLite | Console E2E | None |
| Tenant isolation & validation | Verified | `require_tenant`; cross-tenant 404; field validation | — | M3 SQLite | test_api | None |
| Synthetic labeling | Verified | Seed entities/evidence labelled `SYNTHETIC TEST_ONLY` | Visible in console | Seed fixtures | test_seed (4) | None |
| Health | Verified | `GET /healthz` | ServiceStatus | — | Console E2E | None |

## Platform-wide (TRUSTGRAPH console)

| Feature | Status | Backend | Console | Data source | Verification | Limitation |
|---|---|---|---|---|---|---|
| Overview dashboard from real API data | Verified | Aggregates M1 + M2 + M3 live APIs | Dashboard (threats limit 200 + entities + brands + M1 health; client-side counts; "Sources of truth" card) | All 3 SQLite | Console E2E | Counts computed client-side; dead no-op code at `Dashboard.tsx:143` confirmed inert |
| Global navigation to all module features | Partial | — | 4 live items (Dashboard, Brands, Entities, Threats) + New analysis action | — | Console E2E | M1 scans, sources, analysis history not in nav (pending implementation) |
| Global search & filters | Partial | Server-side search params exist on M1 scans; M2/M3 limited | Threats client search only | — | Console E2E | Entities have none; scans n/a (no pages yet) |
| Responsive desktop & mobile | Partial | — | Tailwind responsive layout | — | Manual desktop browser checks | TenantControl + ServiceStatus `hidden lg:block` (`layout.tsx:164`) — invisible on mobile |
| Empty / loading / error states | Verified | — | Skeletons, empty cards, retry buttons across pages | — | Console E2E | No global error boundary |
| Form validation | Verified | — | NewAnalysis submit gated on evidence > 0; RegisterEntityCard + attach-evidence forms validate | — | Console E2E | — |
| Service health / readiness indicators | Partial | M1 `/api/health`, M2 `/healthz`+`/readyz`, M3 `/healthz` | ServiceStatus | — | Console E2E | Hidden on mobile (same `lg:block`) |
| Analysis history | **Missing** | Depends on M2 jobs list endpoint (missing) | None | — | — | Blocks history page |
| Cross-links between records | Verified | — | ThreatDetail → entity, Re-run deep-links, EntityDetail → Run analysis, brand deep-links | — | Console E2E | Brand → scans link absent (no scans pages) |
| Relationship graph | **Missing** | Real relationship data exists (brand–entity–evidence–threat) | None | — | — | No graph UI |
| Synthetic-demo mode disclosure | Verified | intelMode + `ai.configured` exposed | "Sources of truth" card; SYNTHETIC TEST_ONLY labels; health panels | — | Console E2E | None |
| Tenant switching | Verified | — | TenantControl; localStorage `trustgraph.tenant`; default demo tenant | — | Console E2E | M1 receives no tenant header (M1 has no tenancy model) |
| Production build | Verified | — | `vite build` ✓ + `tsc` clean (2026-10-09) | — | Build records | Production API base URL not configured (proxy-relative only) |
| Frontend test suite | Partial | — | 29 vitest: api 12, brand-bridge 8, format 9 | — | vitest run | No page/component/hook tests |

## Blocked features

| Feature | Blocker |
|---|---|
| Live reputation / social / app intelligence | Vendor adapters not built; LIVE mode still uses demo data for these categories |
| Live Groq AI assessment | `GROQ_API_KEY` absent (`ai.configured: false`); deterministic fallback verified |
| Brand logo, notes, status fields | Not in M1 Prisma Brand model; requires M1 schema change (outside additive scope) |
| Live certificate issuer / age / logo similarity | Not implemented in live tracer (null in LIVE mode) |
| Multi-tenant auth on M1 | M1 has no auth/tenancy model |
| Job cancellation | No cancel operation in M2 (CANCELLED state unreachable) |

## Gap summary (feeds the implementation plan)

Console-level gaps, in dependency order:

1. **M2 analysis history** — additive `GET /api/v1/analysis` route over the existing `list_for_tenant` service; new console page.
2. **M1 scan exposure in console** — three new pages (NewScan, Scans list, ScanDetail) + lib/api functions; optional `?brand=` filter on `GET /api/scans` for brand-scoped history.
3. **M1 brand editing** — new additive `PATCH /api/brands/[id]` (non-demo only, reusing `brandInputSchema`); console edit form. Optional `GET /api/brands/[id]`.
4. **M1 brand creation/deletion console forms** — APIs already exist; console UI missing.
5. **M3 entity updating** — new additive `PATCH /api/v1/entities/{id}`; console edit form.
6. **M3 entity search/filter** — additive `entity_type` / `q` query params on list; console search.
7. **M3 natural-key dedup** — additive 409 semantics with existing entity id in details.
8. **Sources page** — dedicated listing + full creation form (replaces hardcoded `"fixture"` kind).
9. **Dashboard M1 stats wiring** — use `GET /api/stats` instead of client-side counts.
10. **Nav + mobile** — add new sections to nav; make TenantControl/ServiceStatus visible on mobile.
11. **Relationship graph** — real data available (brand–entity–evidence–threat); no UI.

Backend gaps requiring no schema changes: all proposed endpoints are additive and preserve existing clients (M2 frozen scoring untouched; M2 tests stay ≥ 113).
