# TRUSTGRAPH Completion — Design Spec

**Date:** 2026-10-10
**Status:** Approved in chat (backend scope: all three modules; relationship graph: deferred until core passes; commits: per-phase)
**Input:** Master prompt "TRUSTGRAPH — Complete Product Implementation & Feature-Completeness Audit" (Phases 2-8) + `docs/FEATURE_COMPLETENESS.md` gap summary.

## Goal

Close every console-level gap in the feature matrix so that all four modules expose their functionality through the TRUSTGRAPH console over real backend APIs, verified by tests and browser E2E, without rebuilding or regressing anything that works today.

**Hard constraints (from master prompt):**

- Module 2 remains the canonical risk engine. Scoring code stays frozen; only additive read-only routes are permitted. M2 test count must stay ≥ 113.
- Preserve all existing tests and scoring logic. Fix root causes; never weaken tests.
- No fabricated metrics, fake success states, or nonfunctional buttons.
- Secrets and local databases stay out of git. No destructive migrations; existing user data untouched.
- All schema changes: none. Every backend addition is additive and compatible with existing clients.

## Backend additions

### Module 2 — `GET /api/v1/analysis` (jobs list)

- Thin route over existing `JobService.list_for_tenant` (`backend/app/services/jobs.py:35-59`).
- Query: `status` (optional, enum), `limit` (1-200, default 50), `offset` (≥0, default 0). Tenant from `X-Tenant-ID`.
- Response: `{items, total, limit, offset}`, sorted `created_at DESC`. Item: `job_id, brand_id, entity_id, status, threat_id (completed only), error_code (failed only), created_at, updated_at`.
- Files: `app/api.py` (route), `app/schemas.py` (response models). No engine/service changes beyond wiring.
- Tests (pytest, suite grows beyond 113): empty list, ordering, pagination, status filter, tenant isolation, threat_id presence.

### Module 1 — brand editing + brand-scoped scans

- `PATCH /api/brands/[id]`: body = existing Zod `brandInputSchema` (`src/lib/engine/entity.ts:8-23`); 404 `NOT_FOUND`, 400 `DEMO_BRAND` (demo brands immutable), 409 `BRAND_EXISTS` on name collision with a different brand; same normalization as POST; returns updated brand record (list-item shape); `updatedAt` bumped.
- `GET /api/brands/[id]`: single-brand fetch (404 `NOT_FOUND`); lets BrandDetail stop assembling client-side.
- `GET /api/scans?brand=<id>`: filter param on the existing list route.
- Tests: vitest in `module1/` for schema/normalization units (following existing check-script pattern where practical); endpoint behavior verified via live-server checks in Phase 6/7. No changes to engine, providers, or existing routes' contracts.

### Module 3 — entity update, dedup, search

- `PATCH /api/v1/entities/{id}`: body `{display_name?, identifiers?, attributes?}`; identifiers re-normalized; `entity_id`/`entity_type`/`created_at` immutable; 404 on absent/cross-tenant; returns updated record.
- `POST /api/v1/entities` dedup: same tenant + same `entity_type` + same normalized **domain identifier** → 409 `DUPLICATE_ENTITY` with `details.existing_entity_id`. Exact-id 409 unchanged.
- `GET /api/v1/entities?entity_type=&q=`: `entity_type` exact match; `q` case-insensitive substring on `display_name` and identifier values; existing pagination preserved.
- Tests (pytest via `backend/.venv`): update round-trip, immutability, dedup 409 + details, filters, tenant isolation, list regressions.

## Console (frontend/)

**New pages**

| Route | Content |
|---|---|
| `/scan/new` | M1 engine scan: entity type picker (PROFILE/WEBSITE/DOMAIN/APP), input + claimedDeveloper, brand select (or ad-hoc), submit → scan detail |
| `/scans` | M1 scan history: search (server `q`), type/level filters, cursor pagination via `{items,nextCursor,total}` |
| `/scans/:scanId` | Full M1 report: score/level/confidence, signals by category/severity, recommendedActions, risk-over-time, Re-scan, Export JSON, Delete |
| `/sources` | M3 sources: paginated list + create form (full kind input — replaces hardcoded `"fixture"`) |
| `/analysis/history` | M2 jobs list: status chips, pagination, links to `/analysis/:jobId` and completed threats |

**Modified pages**

- `/brands`: create form (POST exists), edit links, delete with confirm (404/DEMO_BRAND errors surfaced).
- `/brands/:brandId`: fetch via new single-brand GET; edit form; delete; brand-scanned scans section (`GET /api/scans?brand=`).
- `/entities`: search + entity_type filter (new M3 params).
- `/entities/:entityId`: edit form (new PATCH).
- Dashboard: replace client-side counts with real `GET /api/stats` from M1 (top signals, avg risk, recent high).
- `layout.tsx`: nav gains Scans, Sources, History; TenantControl + ServiceStatus become visible on mobile (drop `hidden lg:block`).
- `lib/api.ts`: `m1.{createBrand,updateBrand,deleteBrand,getBrand,listScans,getScan,createScan,deleteScan,getStats}`, `m2.listJobs`, `m3.{updateEntity}` + list params.

**Tests:** vitest — api functions for every new endpoint (mocked fetch), component smoke tests for new pages (render + key interactions), form validation cases. Existing 29 stay green.

## Explicitly not built (stays in matrix as Missing/Blocked/future)

Brand logo/notes/status (M1 schema), entity/evidence/source deletion, live vendor intel, live Groq (GROQ_API_KEY), auth/tenancy on M1, job cancellation, relationship graph (deferred — build only after core passes, time permitting).

## Verification plan (Phases 6-8)

1. Browser E2E, 9-step master-prompt flow, repeated across ≥ 2 brands/entities: create brand (M1) → register entity (M3) → attach evidence with source+provenance → submit analysis (M2) → poll to completion → open threat (score/classification/factors/evidence) → navigate back to brand and entity → change threat status → refresh browser, confirm persistence. Plus: brand edit round-trip, scan run from console, dedup 409 surfaced in UI, analysis history page shows the jobs just run.
2. Full suites: frontend typecheck + vitest + `vite build`; M2 ≥ 113; M3 ≥ 71 (+ new); M1 checks + new tests.
3. Error/edge verification: 404/409/400 paths surfaced in UI, tenant isolation, validation messages, service-down states.
4. Deliverables: README setup/startup, updated docs/API.md, architecture diagram, test/build report, real screenshots, demo instructions, limitations section, final module-by-module report.

## Commit plan (per-phase, push only on approval)

1. `docs: feature-completeness audit + completion design spec`
2. `feat(m2): analysis history list endpoint`
3. `feat(m3): entity update, dedup, list filters`
4. `feat(m1): brand editing + brand-scoped scans`
5. `feat(console): api layer + scans/sources/history pages`
6. `feat(console): brand/entity workflows, dashboard stats, nav`
7. `docs: final deliverables (screenshots, README, API docs, report)`
