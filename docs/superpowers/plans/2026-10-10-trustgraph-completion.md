# TRUSTGRAPH Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap in `docs/FEATURE_COMPLETENESS.md` — expose M1 brand intelligence, M2 job history, and M3 entity management through real APIs and a fully wired console, verified end-to-end in a browser.

**Architecture:** Additive, read-mostly backend extensions (an M2 list endpoint over the existing `JobService`; M3 PATCH/dedup/list-filters; M1 brand GET/PATCH and a brand-scoped scan filter) with zero changes to the frozen risk engine, followed by a console layer (expanded `api.ts` surface, five new pages, edits to brands/entities/dashboard/layout) that consumes them. Verification is layered: per-module TDD during build, a 9-step browser E2E across ≥2 brands/entities, then full suites + production build.

**Tech Stack:** FastAPI + SQLAlchemy (M2 `backend/`, M3 `module3/`), Next.js 16 + Prisma + better-sqlite3 (M1 `module1/`), Vite 6 + React 19 + TypeScript strict (frontend), pytest (M2/M3), tsx check scripts (M1), vitest + jsdom + @testing-library (frontend).

**Spec:** `docs/superpowers/specs/2026-10-10-trustgraph-completion-design.md` — the plan argues from this spec; executors read both. Feature matrix: `docs/FEATURE_COMPLETENESS.md`.

## Global Constraints

- **Frozen engine:** M2 scoring/classification logic is untouched. Only additive read-only routes and response models. The M2 suite must stay **≥ 113 tests** (it is 113 today; Task 1 adds 6 → 119).
- **Preserve everything existing:** "Preserve all existing tests and scoring logic." No existing test may be modified, except the three module3 data fixes in Task 3 (unique domains — test *data*, not assertions). The frontend's existing 29 tests stay green.
- **No fake functionality:** "No fabricated metrics, fake success messages, or nonfunctional buttons." Every console element added here is wired to a real endpoint added here (or one that already exists).
- **No second scorer:** "Do not replace the existing risk engine with hardcoded calculations or a second competing scorer."
- **Git hygiene:** "Keep secrets and local database files out of Git." Never commit `.junit.xml`, `*.db`, `*.db-journal`, or `.env*`. "Do not run destructive migrations or reset existing user data." "Fix root causes rather than weakening tests."
- **Commits:** per-phase commits exactly as mapped below; push only on explicit user approval.
- **Shell discipline (Windows Git Bash):** cwd resets between commands — every command block starts with `cd` into the right module directory. Module 3 tests run with `../backend/.venv/Scripts/python.exe`. Delete `.junit.xml` after any run that creates it, before committing.
- **Test commands** (from repo root `C:/Users/Venkatesh/Documents/Qoder/2026-10-08/ff90d917`):
  - M2: `cd backend && .venv/Scripts/python.exe -m pytest -q`
  - M3: `cd module3 && ../backend/.venv/Scripts/python.exe -m pytest -q`
  - M1: `cd module1 && npx tsc --noEmit && npm run test:brands && npm run test:engine`
  - Frontend: `cd frontend && npm run typecheck && npm test`

## Spec-to-code corrections

Everything below was verified against the working tree at commit d552104 (clean). Where the spec and the code disagree, the plan follows the code and this section is the record.

1. **M2 list item has no `updated_at`.** The `AnalysisJob` ORM model has no `updated_at` column and the schema layer is frozen, so list items carry `started_at`/`completed_at` plus a `threat_id` joined from `AnalysisResult` (completed jobs only). Route lives in `backend/app/api/v1/analysis.py`; `JobService.list_for_tenant` (backend/app/services/jobs.py:35-59) already orders `created_at DESC, id` and accepts a `status` filter.
2. **M1 scan-detail and stats endpoints already exist.** `GET/DELETE /api/scans/[id]` (module1/src/app/api/scans/[id]/route.ts) returns `{ report, history }`, and `GET /api/stats` returns `dashboardStats()` (module1/src/lib/scans.ts:191-234) whose shape already matches the spec's stats card. Task 5 therefore only adds brand `GET`/`PATCH` and the `brand` filter on `GET /api/scans`.
3. **module1 has no vitest.** M1 test story = tsx check scripts. Task 5 adds `npm run test:brands` → `scripts/brand-api-check.ts` (pure functions: `brandInputSchema` + `normalizeBrandInput`), following `scripts/engine-check.ts`. Brand HTTP behavior (404/409/DEMO_BRAND) is verified live in Task 16.
4. **`Signal.evidence` is a single string** (module1/src/lib/scans.ts:55, `toReport`), not an array — the frontend type mirrors that.
5. **`m1.createBrand` returns only `{ id }`** (module1/src/app/api/brands/route.ts:30); the console re-fetches the list after create/edit.
6. **module3's `make_entity` fixture defaults to domain `acme-support.com`** (module3/tests/conftest.py) — once Task 3 adds domain dedup, three existing tests would collide; they get unique domains (data fix only).
7. **`EntityUpdate` uses `extra="forbid"`** so PATCHing `entity_type` returns 422 (immutability enforced by the schema, not silently ignored). `display_name` is whitespace-stripped by a `field_validator`; a blank string is rejected with 422. `None` means "leave unchanged" for all three fields.
8. **Frontend vitest runs in the node environment by default.** Page tests carry the `// @vitest-environment jsdom` pragma; the api mock is a full-module factory (`src/test/api-mock.ts`) where every function defaults to `vi.fn(async () => undefined)` so `useApi`'s `.then()` never crashes, and tests call `vi.clearAllMocks()` (not `resetAllMocks`) in `beforeEach`.
9. **`frontend/src/lib/api.test.ts` already exists with 13 passing tests** — Task 6 *appends* a describe block; the existing tests are not modified.
10. **`BadgeTone` has no `VERY_LOW` mapping** (frontend/src/components/ui.tsx) — Task 7 adds dedicated `M1RiskLevelBadge` / `M1RiskScore` / `M1ScoreBar` components instead of overloading `Badge`.
11. **Next.js 16 route params are Promises** — `const { id } = await params;` (module1/src/app/api/brands/[id]/route.ts:7).
12. **module3/api.py needs `or_` added** to `from sqlalchemy import func, select` for the `q` filter.
13. **Vite proxy entries are matched in order** — `/api/scans` and `/api/stats` (both → :3000) must precede `/api/v1` in `frontend/vite.config.ts`.
14. **Mobile visibility** is realized as a Settings toggle in the top bar (`aria-expanded`/`aria-controls="mobile-panel"`) that reveals a sticky mobile panel containing TenantControl + ServiceStatus, because the aside itself is `lg`-only.
15. **Nav gains three items** — Scans (`/scans`), Sources (`/sources`), History (`/analysis/history`); the History route is registered before `/analysis/:jobId`.

## Task → commit map

| Tasks | Commit message |
|---|---|
| (this plan) | `docs: TRUSTGRAPH completion implementation plan` |
| 1 | `feat(m2): analysis history list endpoint` |
| 2–4 | `feat(m3): entity update, dedup, list filters` |
| 5 | `feat(m1): brand editing + brand-scoped scans` |
| 6–11 | `feat(console): api layer + scans/sources/history pages` |
| 12–15 | `feat(console): brand/entity workflows, dashboard stats, nav` |
| 16 | `fix(console): …` (one per real fix found in E2E) |
| 17 | verification only — commit only if fixes were needed |
| 18 | `docs: final deliverables (screenshots, README, API docs, report)` |

---

### Task 1: M2 — analysis job history list endpoint

**Files:**
- Modify: `backend/app/schemas/analysis.py` (append 2 models)
- Modify: `backend/app/api/v1/analysis.py:1-18` (imports) and insert a route above `@router.get("/{job_id}")`
- Test: `backend/tests/test_api.py` (append one class at end of file)

**Interfaces:**
- Consumes: `JobService.list_for_tenant(tenant_id, limit=, offset=, status=) -> tuple[list[AnalysisJob], int]` (backend/app/services/jobs.py:35-59); ORM `AnalysisResult` (`app.models.analysis`) for the job→threat join; helpers `headers(tenant_id)` / `run_analysis(client, tenant_id, brand_id, entity_id)` already in backend/tests/test_api.py:48-63.
- Produces: `GET /api/v1/analysis?status=&limit=&offset=` → `{"items": [{job_id, status, brand_id, entity_id, created_at, started_at, completed_at, error_code, threat_id}], "total", "limit", "offset"}`. Task 6's `m2.listJobs` and Task 11's AnalysisHistory page consume this.

- [x] **Step 1: Write the failing tests**

Append to the end of `backend/tests/test_api.py`:

```python
class TestAnalysisListEndpoint:
    """GET /api/v1/analysis — job history list (read-only, additive)."""

    def test_empty_tenant_gets_empty_page(self, client, tenant_id):
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            headers=headers(tenant_id),
        )
        assert response.status_code == 200
        assert response.json() == {"items": [], "total": 0, "limit": 50, "offset": 0}

    def test_lists_jobs_newest_first_with_threat_id(
        self, client, tenant_id, brand_id, entity_id
    ):
        first = run_analysis(client, tenant_id, brand_id, entity_id)
        second = run_analysis(client, tenant_id, brand_id, entity_id)
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            headers=headers(tenant_id),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 2
        ids = [item["job_id"] for item in body["items"]]
        assert ids.index(second["job_id"]) < ids.index(first["job_id"])
        newest = body["items"][0]
        assert set(newest) == {
            "job_id", "status", "brand_id", "entity_id", "created_at",
            "started_at", "completed_at", "error_code", "threat_id",
        }
        assert newest["status"] == "COMPLETED"
        assert newest["threat_id"] == second["result"]["threat_id"]

    def test_pagination_window(self, client, tenant_id, brand_id, entity_id):
        run_analysis(client, tenant_id, brand_id, entity_id)
        run_analysis(client, tenant_id, brand_id, entity_id)
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            headers=headers(tenant_id),
            params={"limit": 1, "offset": 1},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["limit"] == 1
        assert body["offset"] == 1
        assert body["total"] == 2
        assert len(body["items"]) == 1

    def test_limit_bounds_rejected(self, client, tenant_id):
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            headers=headers(tenant_id),
            params={"limit": 0},
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"

    def test_status_filter(self, client, tenant_id, brand_id, entity_id):
        run_analysis(client, tenant_id, brand_id, entity_id)
        run_analysis(client, tenant_id, brand_id, entity_id)
        failed = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            headers=headers(tenant_id),
            params={"status": "FAILED"},
        ).json()
        completed = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            headers=headers(tenant_id),
            params={"status": "COMPLETED"},
        ).json()
        assert failed["total"] == 0
        assert completed["total"] == 2

    def test_tenant_isolation(self, client, tenant_id, brand_id, entity_id):
        run_analysis(client, tenant_id, brand_id, entity_id)
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            headers=headers(uuid.uuid4()),
        )
        assert response.status_code == 200
        assert response.json()["total"] == 0
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd backend && .venv/Scripts/python.exe -m pytest tests/test_api.py::TestAnalysisListEndpoint -q --junitxml=.junit.xml; rm -f .junit.xml
```

Expected: 6 failures — `GET /api/v1/analysis` returns **405 Method Not Allowed** today (only `POST ""` exists on that path), so every 200-assertion fails.

- [x] **Step 3: Add the response schemas**

Append to the end of `backend/app/schemas/analysis.py`:

```python
class AnalysisJobListItem(BaseModel):
    """One row of the job-history list (GET /api/v1/analysis).

    The ORM job has no updated_at column and the schema layer is frozen, so
    started_at/completed_at stand in for recency and threat_id is joined from
    AnalysisResult — present for completed jobs only.
    """

    job_id: uuid.UUID
    status: JobStatus
    brand_id: uuid.UUID
    entity_id: uuid.UUID
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_code: str | None = None
    threat_id: uuid.UUID | None = None


class AnalysisJobListResponse(BaseModel):
    items: list[AnalysisJobListItem]
    total: int
    limit: int
    offset: int
```

- [x] **Step 4: Add the list route**

In `backend/app/api/v1/analysis.py`, replace the import block (lines 1-18, up to and including the `router = APIRouter(...)` line is untouched — only the imports above it change):

```python
"""Analysis job endpoints."""
from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_idempotency_key, get_settings_dep, get_tenant
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_correlation_id
from app.domain.enums import JobStatus
from app.models.analysis import AnalysisResult
from app.schemas.analysis import (
    AnalysisCreateRequest,
    AnalysisJobListItem,
    AnalysisJobListResponse,
    AnalysisJobResponse,
)
from app.services.idempotency import IdempotencyService, fingerprint_request
from app.services.jobs import JobService
```

Then insert this route directly above `@router.get("/{job_id}", response_model=AnalysisJobResponse)`:

```python
@router.get("", response_model=AnalysisJobListResponse)
def list_analysis_jobs(
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
    status: JobStatus | None = Query(default=None),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AnalysisJobListResponse:
    """Job history for the console — thin read-only route over
    JobService.list_for_tenant. No engine logic is touched."""
    jobs, total = JobService(db).list_for_tenant(
        tenant_id, limit=limit, offset=offset, status=status
    )
    threat_ids = dict(
        db.execute(
            select(AnalysisResult.job_id, AnalysisResult.threat_id).where(
                AnalysisResult.job_id.in_([j.id for j in jobs])
            )
        ).all()
    )
    return AnalysisJobListResponse(
        items=[
            AnalysisJobListItem(
                job_id=j.id,
                status=j.status,
                brand_id=j.brand_id,
                entity_id=j.entity_id,
                created_at=j.created_at,
                started_at=j.started_at,
                completed_at=j.completed_at,
                error_code=j.error_code,
                threat_id=threat_ids.get(j.id),
            )
            for j in jobs
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
```

- [x] **Step 5: Run the new tests to verify they pass**

```bash
cd backend && .venv/Scripts/python.exe -m pytest tests/test_api.py::TestAnalysisListEndpoint -q --junitxml=.junit.xml; rm -f .junit.xml
```

Expected: `6 passed`.

- [x] **Step 6: Run the full M2 suite**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q --junitxml=.junit.xml && echo SUITE_PASS || echo SUITE_FAIL; rm -f .junit.xml
```

Expected: `119 passed` (113 existing + 6 new). If anything below 119 passes, something was lost — investigate before committing.

- [x] **Step 7: Commit**

```bash
git add backend/app/schemas/analysis.py backend/app/api/v1/analysis.py backend/tests/test_api.py
git commit -m "feat(m2): analysis history list endpoint"
```

### Task 2: M3 — entity PATCH (partial update)

**Files:**
- Modify: `module3/module3/schemas.py:12` (pydantic import gains `field_validator`) and insert `EntityUpdate` between `EntityCreate` (ends line 117) and `EvidenceCreate` (starts line 120)
- Modify: `module3/module3/api.py` (insert PATCH route after `get_entity`, line 252)
- Test: `module3/tests/test_entity_update.py` (new file)

**Interfaces:**
- Consumes: `_get_entity(db, tenant, entity_id)` (api.py:104-113 — 404 on missing OR cross-tenant); `_entity_list_item(record)` (api.py:91-101); `normalize_identifiers` (module3/normalization.py); `EntityRecord.updated_at` has `onupdate=utcnow` (module3/models.py:65-67) so any UPDATE auto-bumps it; conftest `make_entity(tenant, **overrides)` defaults to WEBSITE / "Acme Corp Support" / `{"domain": "acme-support.com", "handle": "@acme_help"}`.
- Produces: `PATCH /api/v1/entities/{entity_id}` with body `{display_name?, identifiers?, attributes?}` → 200 with the EntityListItem shape (same as list items). `None` field = leave unchanged; unknown keys → 422 (`extra="forbid"`). Task 13's EditEntityCard consumes this.

- [x] **Step 1: Write the failing tests**

Create `module3/tests/test_entity_update.py`:

```python
"""PATCH /api/v1/entities/{entity_id} — partial entity update
(SYNTHETIC TEST_ONLY data throughout)."""
from __future__ import annotations

import uuid

ENTITY_DETAIL_KEYS = {
    "entity_id",
    "tenant_id",
    "entity_type",
    "display_name",
    "identifiers",
    "attributes",
    "created_at",
    "updated_at",
}


class TestEntityUpdate:
    def test_update_display_name_and_identifiers(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={
                "display_name": "Synthetic Impersonator Two",
                "identifiers": {
                    "domain": "https://WWW.Synthetic-Two.example/verify",
                    "handle": "@Synthetic_Two",
                },
            },
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert set(body) == ENTITY_DETAIL_KEYS
        assert body["display_name"] == "Synthetic Impersonator Two"
        assert body["identifiers"]["domain"] == "synthetic-two.example"
        assert body["identifiers"]["handle"] == "synthetic_two"

    def test_partial_update_leaves_other_fields(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"display_name": "Renamed Support Site"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["display_name"] == "Renamed Support Site"
        assert body["identifiers"]["domain"] == "acme-support.com"
        assert body["identifiers"]["handle"] == "acme_help"

    def test_empty_body_is_a_noop(self, client, tenant_headers, tenant_a, make_entity):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        assert response.json()["display_name"] == "Acme Corp Support"

    def test_update_bumps_updated_at(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        before = client.get(
            "/api/v1/entities", headers=tenant_headers(tenant_a)
        ).json()["items"][0]
        assert before["entity_id"] == created["entity_id"]
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"display_name": "Renamed Support Site"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        after = client.get(
            "/api/v1/entities", headers=tenant_headers(tenant_a)
        ).json()["items"][0]
        assert after["updated_at"] > before["updated_at"]

    def test_entity_type_immutable(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"entity_type": "SOCIAL_PROFILE"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"
        fetched = client.get(
            f"/api/v1/entities/{created['entity_id']}",
            headers=tenant_headers(tenant_a),
        )
        assert fetched.json()["entity_type"] == "WEBSITE"

    def test_blank_display_name_rejected(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"display_name": "   "},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"

    def test_unknown_entity_404(self, client, tenant_headers, tenant_a):
        response = client.patch(
            f"/api/v1/entities/{uuid.uuid4()}",
            json={"display_name": "Ghost Site"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"

    def test_cross_tenant_patch_404_and_untouched(
        self, client, tenant_headers, tenant_a, tenant_b, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"display_name": "Hostile Takeover"},
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"
        original = client.get(
            f"/api/v1/entities/{created['entity_id']}",
            headers=tenant_headers(tenant_a),
        )
        assert original.json()["display_name"] == "Acme Corp Support"
```

- [x] **Step 2: Run the new tests to verify they fail**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest tests/test_entity_update.py -q
```

Expected: all 8 FAIL with `405 Method Not Allowed` (the path exists with GET/POST only, no PATCH route yet).

- [x] **Step 3: Add the `EntityUpdate` schema**

In `module3/module3/schemas.py`, change the pydantic import:

```python
from pydantic import BaseModel, ConfigDict, Field, field_validator
```

Then insert between `EntityCreate` and `EvidenceCreate`:

```python
class EntityUpdate(BaseModel):
    """PATCH /api/v1/entities/{entity_id} — partial update, re-normalized on
    save. None means "leave unchanged"; entity_id/entity_type/created_at are
    immutable (extra keys are rejected so clients get a 422 instead of a
    silent ignore)."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=300)
    identifiers: dict[str, str] | None = None
    attributes: dict[str, Any] | None = None

    @field_validator("display_name")
    @classmethod
    def _strip_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("display_name cannot be blank")
        return stripped
```

(The `field_validator` is required because pydantic does not strip whitespace — `"   "` is length 3 and would otherwise pass `min_length=1`.)

- [x] **Step 4: Add the PATCH route**

In `module3/module3/api.py`, directly after the `get_entity` route (line 252), add:

```python
@router.patch("/entities/{entity_id}", response_model=schemas.EntityListItem)
def update_entity(
    entity_id: uuid.UUID,
    payload: schemas.EntityUpdate,
    db: DbDep,
    tenant: TenantDep,
) -> schemas.EntityListItem:
    """Partial update for the console. None = leave unchanged; identifiers
    are re-normalized through the same ingest pipeline (stays canonical)."""
    record = _get_entity(db, tenant, entity_id)
    if payload.display_name is not None:
        record.display_name = payload.display_name
    if payload.identifiers is not None:
        record.identifiers = normalize_identifiers(payload.identifiers)
    if payload.attributes is not None:
        record.attributes = dict(payload.attributes)
    db.commit()
    db.refresh(record)
    return _entity_list_item(record)
```

(`updated_at` bumps automatically via `onupdate=utcnow`; whole-dict assignment keeps SQLAlchemy's JSON change detection happy.)

- [x] **Step 5: Run the new tests to verify they pass**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest tests/test_entity_update.py -q
```

Expected: `8 passed`.

- [x] **Step 6: Run the full M3 suite**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest -q
```

Expected: `79 passed` (71 existing + 8 new), 0 failures. Existing tests must be untouched by this task — if any pre-existing test fails, investigate before continuing.

(No commit yet — Tasks 2-4 land as one M3 commit, per the commit map.)

---

### Task 3: M3 — duplicate-entity detection on create

**Files:**
- Modify: `module3/module3/api.py` (`create_entity`, lines 193-215)
- Modify (test data, not assertions): `module3/tests/test_list_endpoints.py` (test_newest_first, test_pagination) and `module3/tests/test_api.py:327` (test_list_scoped_to_entity) — each creates 2+ WEBSITE entities that share the default domain `acme-support.com` and would now 409
- Test: `module3/tests/test_entity_dedup.py` (new file)

**Interfaces:**
- Consumes: `normalize_identifiers` (identifiers must be canonical BEFORE the conflict probe — the stored form is canonical); `EntityRecord.identifiers["domain"].as_string()` (SQLAlchemy JSON path comparison; SQLAlchemy renders `json_extract` on SQLite); `AppError(ErrorCode.DUPLICATE_ENTITY, message, http_status=409, details=...)` — same shape as the existing entity-id replay error (api.py:198-203).
- Produces: `POST /api/v1/entities` now returns **409 DUPLICATE_ENTITY** with `details.existing_entity_id` when the same tenant already has an entity of the **same entity_type** whose normalized `domain` identifier matches. Different type, no domain identifier, or different tenant → still 201. Task 16's browser E2E surfaces this 409 in the console UI.

- [x] **Step 1: Write the failing tests**

Create `module3/tests/test_entity_dedup.py`:

```python
"""Duplicate-entity detection on create — domain match within
(tenant, entity_type) 409s instead of silently creating a second entity
(SYNTHETIC TEST_ONLY data throughout)."""
from __future__ import annotations

import uuid


class TestEntityDedup:
    def test_same_domain_same_type_conflicts(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        existing = make_entity(tenant_a)
        response = client.post(
            "/api/v1/entities",
            json={
                "entity_type": "WEBSITE",
                "display_name": "Acme Support Clone",
                "identifiers": {"domain": "ACME-SUPPORT.COM"},
            },
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 409
        body = response.json()
        assert body["error_code"] == "DUPLICATE_ENTITY"
        assert body["details"]["existing_entity_id"] == existing["entity_id"]

    def test_same_domain_different_type_allowed(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        make_entity(tenant_a)
        response = client.post(
            "/api/v1/entities",
            json={
                "entity_type": "DOMAIN",
                "display_name": "Acme Support Domain Record",
                "identifiers": {"domain": "https://www.acme-support.com/login"},
            },
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 201

    def test_entities_without_domain_not_deduped(
        self, client, tenant_headers, tenant_a
    ):
        payload = {
            "entity_type": "SOCIAL_PROFILE",
            "display_name": "Synthetic Profile",
            "identifiers": {"handle": "@same_handle"},
        }
        first = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        second = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        assert first.status_code == 201
        assert second.status_code == 201

    def test_same_domain_cross_tenant_allowed(
        self, client, tenant_headers, tenant_a, tenant_b, make_entity
    ):
        make_entity(tenant_a)
        response = client.post(
            "/api/v1/entities",
            json={
                "entity_type": "WEBSITE",
                "display_name": "Other Tenant Same Domain",
                "identifiers": {"domain": "acme-support.com"},
            },
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 201

    def test_exact_id_replay_reports_entity_id(
        self, client, tenant_headers, tenant_a
    ):
        entity_id = uuid.uuid4()
        payload = {"entity_type": "WEBSITE", "entity_id": str(entity_id)}
        first = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        assert first.status_code == 201
        second = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        assert second.status_code == 409
        assert second.json()["details"]["entity_id"] == str(entity_id)
```

- [x] **Step 2: Run the new tests to verify the right ones fail**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest tests/test_entity_dedup.py -q
```

Expected: `test_same_domain_same_type_conflicts` FAILS (got 201, expected 409); the other 4 PASS (that behavior already exists). `test_exact_id_replay_reports_entity_id` passes against the current entity-id check and must keep passing after the change.

- [x] **Step 3: Add the conflict probe to `create_entity`**

In `module3/module3/api.py`, replace the body of `create_entity` from the entity-id check through the `record = EntityRecord(...)` block (lines 196-211) with:

```python
    entity_id = payload.entity_id or uuid.uuid4()
    if db.get(EntityRecord, entity_id) is not None:
        raise AppError(
            ErrorCode.DUPLICATE_ENTITY,
            f"Entity '{entity_id}' already exists.",
            http_status=409,
            details={"entity_id": str(entity_id)},
        )
    normalized = normalize_identifiers(payload.identifiers)
    domain_key = normalized.get("domain")
    if domain_key:
        conflict_id = db.scalars(
            select(EntityRecord.entity_id)
            .where(
                EntityRecord.tenant_id == tenant,
                EntityRecord.entity_type == payload.entity_type.value,
                EntityRecord.identifiers["domain"].as_string() == domain_key,
            )
            .limit(1)
        ).first()
        if conflict_id is not None:
            raise AppError(
                ErrorCode.DUPLICATE_ENTITY,
                f"An entity with domain '{domain_key}' already exists for this "
                "tenant and type.",
                http_status=409,
                details={"existing_entity_id": str(conflict_id)},
            )
    record = EntityRecord(
        entity_id=entity_id,
        tenant_id=tenant,
        entity_type=payload.entity_type.value,
        display_name=payload.display_name,
        identifiers=normalized,
        attributes=dict(payload.attributes),
    )
```

Key points: the probe runs on the **normalized** domain (so `ACME-SUPPORT.COM` and `https://www.acme-support.com/login` both collapse to `acme-support.com` before comparison), and the stored record reuses `normalized` instead of calling `normalize_identifiers` twice.

- [x] **Step 4: Update the three existing tests that now collide**

These tests create multiple WEBSITE entities sharing the default `acme-support.com` domain — under the new probe `make_entity` 409s. The fix is test **data**, not assertions:

In `module3/tests/test_list_endpoints.py`, `test_newest_first`:

```python
        first = make_entity(
            tenant_a,
            display_name="synthetic-first",
            identifiers={"domain": "synthetic-first.example"},
        )
        second = make_entity(
            tenant_a,
            display_name="synthetic-second",
            identifiers={"domain": "synthetic-second.example"},
        )
```

In the same file, `test_pagination`:

```python
        for i in range(3):
            make_entity(
                tenant_a,
                display_name=f"synthetic-{i}",
                identifiers={"domain": f"synthetic-{i}.example"},
            )
```

In `module3/tests/test_api.py`, `test_list_scoped_to_entity` (line 327):

```python
        second = make_entity(
            tenant_a,
            display_name="Other Site",
            identifiers={"domain": "other-site.example"},
        )
```

(`module3/seed.py` is unaffected — it inserts `EntityRecord` rows directly, not through this route.)

- [x] **Step 5: Run the new tests to verify they pass**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest tests/test_entity_dedup.py -q
```

Expected: `5 passed`.

- [x] **Step 6: Run the full M3 suite**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest -q
```

Expected: `84 passed` (71 existing + 8 update + 5 dedup), 0 failures. If an untouched existing test now 409s, it is creating colliding entities — fix its data the same way as Step 4, never the assertions.

(No commit yet — one M3 commit after Task 4.)

---

### Task 4: M3 — entity list filters (`entity_type`, `q`)

**Files:**
- Modify: `module3/module3/api.py:22` (`from sqlalchemy import func, select` gains `or_`) and `list_entities` (lines 218-247)
- Test: `module3/tests/test_entity_filters.py` (new file)

**Interfaces:**
- Consumes: `Annotated` (already imported, api.py:19); `schemas.EntityType` (FastAPI 422s invalid enum values in query params for free); `_entity_list_item`.
- Produces: `GET /api/v1/entities?entity_type=&q=` — `entity_type` exact-matches the enum value; `q` (max 200 chars) case-insensitively matches `display_name` OR the normalized `domain` OR the normalized `handle` identifier (LIKE `%q%` on `func.lower(...)`). Filters compose with `AND` and apply to both `total` and the returned page. Tasks 9/13 (Sources page, Entities page search box) consume this.

- [x] **Step 1: Write the failing tests**

Create `module3/tests/test_entity_filters.py`:

```python
"""GET /api/v1/entities filters — entity_type and free-text q over
display_name / domain / handle (SYNTHETIC TEST_ONLY data throughout)."""
from __future__ import annotations

import pytest


@pytest.fixture
def seeded(client, tenant_headers, tenant_a, make_entity):
    make_entity(tenant_a)  # WEBSITE "Acme Corp Support" / acme-support.com / acme_help
    make_entity(
        tenant_a,
        entity_type="SOCIAL_PROFILE",
        display_name="Acme Help Desk",
        identifiers={"handle": "@acme_helper"},
    )
    make_entity(
        tenant_a,
        display_name="Unrelated Telecom",
        identifiers={"domain": "unrelated-telecom.example"},
    )


class TestEntityTypeFilter:
    def test_filters_to_matching_type(self, client, tenant_headers, tenant_a, seeded):
        response = client.get(
            "/api/v1/entities",
            params={"entity_type": "WEBSITE"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["display_name"] == "Acme Corp Support"

    def test_other_type_still_listed(self, client, tenant_headers, tenant_a, seeded):
        response = client.get(
            "/api/v1/entities",
            params={"entity_type": "MOBILE_APP"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        assert response.json()["total"] == 0

    def test_invalid_type_rejected(self, client, tenant_headers, tenant_a, seeded):
        response = client.get(
            "/api/v1/entities",
            params={"entity_type": "SPACE_STATION"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"


class TestTextFilter:
    def test_q_matches_display_name_case_insensitive(
        self, client, tenant_headers, tenant_a, seeded
    ):
        response = client.get(
            "/api/v1/entities",
            params={"q": "ACME CORP"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["display_name"] == "Acme Corp Support"

    def test_q_matches_partial_domain(
        self, client, tenant_headers, tenant_a, seeded
    ):
        response = client.get(
            "/api/v1/entities",
            params={"q": "acme-sup"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["identifiers"]["domain"] == "acme-support.com"

    def test_q_matches_handle(
        self, client, tenant_headers, tenant_a, seeded
    ):
        response = client.get(
            "/api/v1/entities",
            params={"q": "acme_helper"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["display_name"] == "Acme Help Desk"

    def test_q_combines_with_type_filter(
        self, client, tenant_headers, tenant_a, seeded
    ):
        response = client.get(
            "/api/v1/entities",
            params={"q": "acme", "entity_type": "SOCIAL_PROFILE"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["display_name"] == "Acme Help Desk"

    def test_q_scoped_to_tenant(self, client, tenant_headers, tenant_b, seeded):
        response = client.get(
            "/api/v1/entities",
            params={"q": "acme"},
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 200
        assert response.json()["total"] == 0
```

- [x] **Step 2: Run the new tests to verify they fail**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest tests/test_entity_filters.py -q
```

Expected: the filter tests FAIL (unfiltered results — `total == 3` instead of 1); `test_invalid_type_rejected` may already PASS because FastAPI rejects unknown query values only after the param is declared (it currently isn't, so this one fails with `total == 3` too).

- [x] **Step 3: Add the filters to `list_entities`**

In `module3/module3/api.py`, first extend the sqlalchemy import (line 22):

```python
from sqlalchemy import func, or_, select
```

Then replace `list_entities` (lines 218-247) with:

```python
@router.get("/entities", response_model=schemas.EntityListResponse)
def list_entities(
    db: DbDep,
    tenant: TenantDep,
    entity_type: schemas.EntityType | None = Query(default=None),
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> schemas.EntityListResponse:
    """Tenant-scoped entity list for the console UI, newest first, with
    optional entity_type and free-text filters. Module 2 never calls this —
    it fetches entities by ID only."""
    conditions = [EntityRecord.tenant_id == tenant]
    if entity_type is not None:
        conditions.append(EntityRecord.entity_type == entity_type.value)
    if q:
        pattern = f"%{q.lower()}%"
        conditions.append(
            or_(
                func.lower(EntityRecord.display_name).like(pattern),
                func.lower(EntityRecord.identifiers["domain"].as_string()).like(
                    pattern
                ),
                func.lower(EntityRecord.identifiers["handle"].as_string()).like(
                    pattern
                ),
            )
        )
    total = (
        db.scalar(
            select(func.count()).select_from(EntityRecord).where(*conditions)
        )
        or 0
    )
    records = db.scalars(
        select(EntityRecord)
        .where(*conditions)
        .order_by(EntityRecord.created_at.desc(), EntityRecord.entity_id)
        .limit(limit)
        .offset(offset)
    ).all()
    return schemas.EntityListResponse(
        items=[_entity_list_item(record) for record in records],
        total=total,
        limit=limit,
        offset=offset,
    )
```

(`display_name` can be NULL — `func.lower(NULL) LIKE '%x%'` is NULL/unknown, which never satisfies the WHERE, so unnamed entities simply don't match `q`; that is the desired behavior. `q` compares against the **stored canonical** identifiers, which is why `acme_helper` matches the handle stored as `acme_helper`.)

- [x] **Step 4: Run the new tests to verify they pass**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest tests/test_entity_filters.py -q
```

Expected: `8 passed`.

- [x] **Step 5: Run the full M3 suite**

```bash
cd module3 && ../backend/.venv/Scripts/python.exe -m pytest -q
```

Expected: `92 passed` (71 existing + 21 new across Tasks 2-4), 0 failures.

- [x] **Step 6: Commit (M3 phase)**

```bash
git add module3/module3/api.py module3/module3/schemas.py module3/tests/test_entity_update.py module3/tests/test_entity_dedup.py module3/tests/test_entity_filters.py module3/tests/test_list_endpoints.py module3/tests/test_api.py
git commit -m "feat(m3): entity update, dedup, list filters"
```

### Task 5: M1 — brand editing (GET/PATCH) + brand-scoped scan list + shared input normalization

**Files:**
- Create: `module1/src/lib/brand-input.ts` (shared create/edit normalizer)
- Create: `module1/scripts/brand-api-check.ts` (check script; `npm run test:brands`)
- Modify: `module1/src/app/api/brands/route.ts` (POST uses the shared normalizer)
- Modify: `module1/src/app/api/brands/[id]/route.ts` (add GET + PATCH around the existing DELETE)
- Modify: `module1/src/lib/scans.ts:131-149` (ScanQuery gains `brand`; listScans where gains `brandId`) and after `getBrand` (line 256, add `getBrandDetail`)
- Modify: `module1/src/app/api/scans/route.ts:54-61` (listQuery gains `brand`)
- Modify: `module1/package.json` (add `test:brands` script)

**Interfaces:**
- Consumes: `brandInputSchema` (module1/src/lib/engine/entity.ts:16-23 — name trimmed min 2 max 80; five list fields accept array or newline/comma string, trimmed, max 20 entries); `normalizeBrand` (entity.ts:291-314 — already implements the exact canonical forms: domains strip scheme/path/`www.` + lowercase, handles strip `@` + lowercase, prefixes/keywords lowercase); `apiError`/`zodToApiError`/`readJson` (module1/src/lib/api.ts); Prisma `Brand` (`name @unique`, `updatedAt @updatedAt` — PATCH auto-bumps, no manual timestamp); `listBrands`'s mapping pattern (scans.ts:248-251). `GET/DELETE /api/scans/[id]` and `GET /api/stats` already exist — untouched.
- Produces: `GET /api/brands/{id}` → 200 `{id, name, officialDomains, officialHandles, appDevelopers, packagePrefixes, keywords, isDemo, scanCount}` or 404 `NOT_FOUND`; `PATCH /api/brands/{id}` (body = brandInputSchema) → 200 with the same shape, 404, 400 `DEMO_BRAND`, or 409 `BRAND_EXISTS` `{field: "name"}`; `GET /api/scans?brand={id}` filters to that brand's scans; `normalizeBrandInput(b: BrandInput)` shared by POST and PATCH so create/edit can never drift. Tasks 12-13 (BrandFormCard, BrandDetail, Scans page brand filter) consume these.

- [x] **Step 1: Write the failing check script**

Create `module1/scripts/brand-api-check.ts` (relative imports, matching `scripts/engine-check.ts`):

```ts
/**
 * Checks the brand input pipeline shared by POST/PATCH /api/brands —
 * validation and canonical normalization. `npm run test:brands`
 */
import { brandInputSchema } from "../src/lib/engine/entity";
import { normalizeBrandInput } from "../src/lib/brand-input";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
};

// 1. Valid input normalizes every field to canonical form.
const parsed = brandInputSchema.safeParse({
  name: "  Acme  ",
  officialDomains: "https://WWW.Acme.com/pricing",
  officialHandles: "@Acme_Help",
  appDevelopers: "Acme Ltd",
  packagePrefixes: "Com.Acme",
  keywords: "Acme",
});
if (parsed.success) {
  const data = normalizeBrandInput(parsed.data);
  check("name trimmed", data.name === "Acme", JSON.stringify(data.name));
  check(
    "domains canonical",
    JSON.stringify(data.officialDomains) === '["acme.com"]',
    JSON.stringify(data.officialDomains),
  );
  check(
    "handles canonical",
    JSON.stringify(data.officialHandles) === '["acme_help"]',
    JSON.stringify(data.officialHandles),
  );
  check(
    "developers preserved",
    JSON.stringify(data.appDevelopers) === '["Acme Ltd"]',
    JSON.stringify(data.appDevelopers),
  );
  check(
    "prefixes lowercased",
    JSON.stringify(data.packagePrefixes) === '["com.acme"]',
    JSON.stringify(data.packagePrefixes),
  );
  check(
    "keywords lowercased",
    JSON.stringify(data.keywords) === '["acme"]',
    JSON.stringify(data.keywords),
  );
  check("no id leakage into prisma data", !("id" in data));
} else {
  check("valid input parses", false, JSON.stringify(parsed.error.issues));
}

// 2. Multi-line / comma-separated list fields split into entries.
const multi = brandInputSchema.safeParse({
  name: "Acme",
  officialDomains: "a.com\nb.com, c.com",
});
check(
  "multi-line list splits",
  multi.success && multi.data.officialDomains?.length === 3 && multi.data.officialDomains[2] === "c.com",
  multi.success ? JSON.stringify(multi.data.officialDomains) : "parse failed",
);

// 3. Validation rejects missing / too-short names.
check("missing name rejected", !brandInputSchema.safeParse({}).success);
check("1-char name rejected", !brandInputSchema.safeParse({ name: "x" }).success);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll brand-input checks passed");
process.exit(failures ? 1 : 0);
```

- [x] **Step 2: Run it to verify it fails**

```bash
cd module1 && npx tsx scripts/brand-api-check.ts
```

Expected: FAILS — `Cannot find module '../src/lib/brand-input'` (the module doesn't exist yet).

- [x] **Step 3: Create the shared normalizer**

Create `module1/src/lib/brand-input.ts`:

```ts
import type { z } from "zod";
import { brandInputSchema, normalizeBrand } from "./engine/entity";

export type BrandInput = z.infer<typeof brandInputSchema>;

/**
 * Single place raw brand input becomes canonical Prisma column data —
 * shared by POST /api/brands and PATCH /api/brands/[id] so create and
 * edit can never drift apart. Delegates to normalizeBrand, which owns
 * the canonical domain/handle/prefix/keyword forms; strips `id` so the
 * caller's where-clause is the only source of identity.
 */
export function normalizeBrandInput(b: BrandInput) {
  const brand = normalizeBrand(b);
  return {
    name: brand.name,
    officialDomains: brand.officialDomains,
    officialHandles: brand.officialHandles,
    appDevelopers: brand.appDevelopers,
    packagePrefixes: brand.packagePrefixes,
    keywords: brand.keywords,
  };
}
```

(`normalizeBrand` already applies exactly the transformations the POST route inlines today — entity.ts:308-312 vs brands/route.ts:23-27 — so switching POST to this helper is behavior-preserving.)

- [x] **Step 4: Run the check script to verify it passes**

```bash
cd module1 && npx tsx scripts/brand-api-check.ts
```

Expected: every line `✔`, exit code 0, `All brand-input checks passed`.

- [x] **Step 5: Add `getBrandDetail` and the brand filter to `scans.ts`**

In `module1/src/lib/scans.ts`, first extend `ScanQuery` (line 131):

```ts
export interface ScanQuery {
  type?: EntityType;
  level?: RiskLevel;
  q?: string;
  target?: string;
  brand?: string;
  limit?: number;
  cursor?: string;
}
```

Then add `brandId` as the first spread in the `listScans` where object (line 142):

```ts
  const where: Prisma.ScanWhereInput = {
    ...(query.brand ? { brandId: query.brand } : {}),
    ...(query.type ? { entityType: query.type } : {}),
    ...(query.level ? { riskLevel: query.level } : {}),
    ...(query.target ? { target: query.target } : {}),
    ...(query.q
      ? { OR: [{ target: { contains: query.q.toLowerCase() } }, { input: { contains: query.q } }, { displayName: { contains: query.q } }] }
      : {}),
  };
```

Then, after `getBrand` (line 256), add:

```ts
/** Full brand row for the console — BrandReference plus id/isDemo/scanCount
 * (same shape listBrands returns, for the detail/edit page). */
export async function getBrandDetail(id: string) {
  const b = await prisma.brand.findUnique({
    where: { id },
    include: { _count: { select: { scans: true } } },
  });
  return b ? { ...normalizeBrand(b), id: b.id, isDemo: b.isDemo, scanCount: b._count.scans } : null;
}
```

- [x] **Step 6: Accept `brand` in the scans list query**

In `module1/src/app/api/scans/route.ts`, the listQuery (line 54) gains one field:

```ts
const listQuery = z.object({
  type: z.enum(ENTITY_TYPES).optional(),
  level: z.enum(RISK_LEVELS).optional(),
  q: z.string().trim().max(200).optional(),
  target: z.string().trim().max(300).optional(),
  brand: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(64).optional(),
});
```

- [x] **Step 7: Rewrite the brand routes**

Replace the whole of `module1/src/app/api/brands/[id]/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, readJson, zodToApiError } from "@/lib/api";
import { brandInputSchema } from "@/lib/engine/entity";
import { getBrandDetail } from "@/lib/scans";
import { normalizeBrandInput } from "@/lib/brand-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandDetail(id);
  if (!brand) return apiError(404, "NOT_FOUND", "Brand not found.");
  return NextResponse.json(brand);
}

/**
 * Full-replace edit of the editable fields (name + the five lists) — the
 * console's edit form always submits the complete shape. Demo brands are
 * read-only: they back the sample entities.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.brand.findUnique({ where: { id } });
  if (!existing) return apiError(404, "NOT_FOUND", "Brand not found.");
  if (existing.isDemo) return apiError(400, "DEMO_BRAND", "Demo brands can't be edited — they back the sample entities.");
  const parsed = brandInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return zodToApiError(parsed.error);
  const clash = await prisma.brand.findUnique({ where: { name: parsed.data.name } });
  if (clash && clash.id !== id) {
    return apiError(409, "BRAND_EXISTS", `A protected brand named "${parsed.data.name}" already exists.`, { field: "name" });
  }
  await prisma.brand.update({ where: { id }, data: normalizeBrandInput(parsed.data) });
  return NextResponse.json(await getBrandDetail(id));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await prisma.brand.findUnique({ where: { id } });
  if (!b) return apiError(404, "NOT_FOUND", "Brand not found.");
  if (b.isDemo) return apiError(400, "DEMO_BRAND", "Demo brands can't be deleted — they back the sample entities.");
  await prisma.brand.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
```

(`updatedAt` bumps automatically via `@updatedAt` — no manual timestamp.)

Then in `module1/src/app/api/brands/route.ts`, replace the inline normalization block (lines 14-31) with the shared helper:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandInputSchema } from "@/lib/engine/entity";
import { listBrands } from "@/lib/scans";
import { normalizeBrandInput } from "@/lib/brand-input";
import { apiError, readJson, zodToApiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ items: await listBrands() });
}

export async function POST(req: Request) {
  const parsed = brandInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return zodToApiError(parsed.error);
  const b = parsed.data;
  const exists = await prisma.brand.findUnique({ where: { name: b.name } });
  if (exists) return apiError(409, "BRAND_EXISTS", `A protected brand named "${b.name}" already exists.`, { field: "name" });
  const created = await prisma.brand.create({ data: normalizeBrandInput(b) });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
```

- [x] **Step 8: Register the script and run every M1 check**

In `module1/package.json` scripts, add after `"test:engine"`:

```json
    "test:brands": "tsx scripts/brand-api-check.ts",
```

Then run:

```bash
cd module1 && npx tsc --noEmit && npm run test:brands && npm run test:engine
```

Expected: tsc clean (no output); `test:brands` all ✔; `test:engine` all ✔ (existing 12-entity expectations unchanged — nothing in the pipeline was touched).

- [x] **Step 9: Commit (M1 phase)**

```bash
git add module1/src/lib/brand-input.ts module1/scripts/brand-api-check.ts module1/src/app/api/brands/route.ts "module1/src/app/api/brands/[id]/route.ts" module1/src/lib/scans.ts module1/src/app/api/scans/route.ts module1/package.json
git commit -m "feat(m1): brand editing + brand-scoped scans"
```

<!-- PLAN-CONTINUES -->

## Progress log

- Tasks 1–5 complete — commits 5f8709c (m2), 1e54c15 (m3), 9f6c34f (m1). M2 119, M3 92, M1 tsc + test:brands + test:engine green.
- Tasks 6–11 complete — commit 804ddcb `feat(console): api layer + scans/sources/history pages`. api.ts surface + types, ScanNew/Scans/ScanDetail, Sources, AnalysisHistory, M1RiskLevelBadge/M1RiskScore/M1ScoreBar, vite proxy ordering, api-mock factory; frontend suite 58 green.
- Tasks 12–15 complete — commit 74a485e `feat(console): brand/entity workflows, dashboard stats, nav`. BrandFormCard create/edit, BrandDetail edit + brand-scoped scans + threats card, Brands row actions + error footer, Entities search + entity_type filter, EntityDetail edit form (m3.updateEntity), Dashboard GET /api/stats section (recent high-risk scans, top signals, 6th stat card), 7-item nav + mobile settings panel; frontend suite 64 green (6 new console-workflows tests).
- Task 16 (multi-brand browser E2E) — pending.
- Task 17 (full suites + production build) — pending.
- Task 18 (deliverables + final report) — pending.
