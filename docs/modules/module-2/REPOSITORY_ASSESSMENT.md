# TRUSTGRAPH — Module 2 Repository Assessment

> Phase 1 reconnaissance report. Produced before any implementation.
> Status labels used throughout: `IMPLEMENTED`, `CONTRACT_ONLY`, `MOCK`, `TBD`, `EXTERNAL_DEPENDENCY`.

## 1. Repository Reality

| Item | Finding |
|---|---|
| Project working directory | `C:\Users\Venkatesh\Documents\Qoder\2026-10-08\ff90d917` — **completely empty** (no source, no configs, no docs) |
| Git repository root | `C:/Users/Venkatesh` (the user's home directory) — an anomaly; the repo tracks nothing (`git ls-files` is empty), only two empty "first commit" commits exist on `main` |
| Tracked files | None — `git ls-files` returns empty output |
| Modules 1 / 3 / 4 | **DO NOT EXIST** — no code, schemas, APIs, or contracts anywhere in the workspace |
| Existing architecture | None |
| Existing dependencies | None at project level (host Python has ad-hoc packages) |
| Existing conventions | None to inherit |
| Docker / dev environment | None |
| Database | No PostgreSQL, no migrations, no connection config found |
| Authentication / authorization | None exists |
| README / documentation | None |

Per the master prompt: *"Where the repository is empty, initialize a clean production-grade architecture."*
This is the situation. All Module 1/3/4 dependencies are therefore `CONTRACT_ONLY` (with `MOCK` adapters for tests/local dev) and are documented as `CONTRACT_PROPOSED` in the integration matrix.

## 2. Git Safety Constraints

- The git repo is rooted at the **user's home directory**, not at the project directory. Untracked files listed by `git status` are unrelated personal directories.
- **Constraint honored:** all Module 2 work is strictly confined to the project working directory; no unrelated files are touched, no resets, no force pushes, no commits unless requested.
- A project-local `.gitignore` shields build artifacts from the accidental home-dir repo.

## 3. Host Environment

| Component | Value |
|---|---|
| OS | Windows 10 (10.0.26300), x64 |
| Python | 3.14.3 (`Python314`) |
| FastAPI | 0.140.0 |
| Pydantic | 2.12.5 |
| SQLAlchemy | 2.1.4 (installed for this project) |
| Alembic | 1.20.0 |
| pytest | 9.1.1 |
| httpx | 0.28.1 |
| scikit-learn | 1.9.0 (host-global; usable as optional ML adapter) |
| sentence-transformers / torch | NOT installed — multi-GB install deliberately avoided; treated as `EXTERNAL_DEPENDENCY` behind an interface |
| PostgreSQL server | Not available locally — development/tests use SQLite via SQLAlchemy; PostgreSQL remains the production target via `DATABASE_URL` |

## 4. Technology Decisions (frozen for this implementation)

- **Backend:** Python 3.11+ / FastAPI / Pydantic v2 / SQLAlchemy 2.x (sync sessions, cross-backend types `Uuid`/`JSON`) / Alembic / pytest.
- **Database:** PostgreSQL in production, SQLite for local dev + tests, selected purely by `DATABASE_URL`. All Module 2 tables are cross-backend.
- **ML:** replaceable interfaces (`TextSimilarityModel`, `VisualSimilarityModel`, `IdentitySimilarityModel`) + deterministic pure-Python baselines; optional scikit-learn adapter. No hard coupling to any ML provider; `sentence-transformers` documented as optional external dependency.
- **Async jobs:** `AnalysisJobQueue` abstraction with an in-process asyncio worker (`worker_mode="in_process"`) and a synchronous executor for deterministic tests (`worker_mode="sync"`). No `time.sleep()`, no uncontrolled threads. Redis/Celery can replace the queue behind the same interface.
- **Auth:** no central authentication exists → define an integration boundary (`TenantContext` from `X-Tenant-ID` header) rather than inventing a competing auth service. Marked `TBD` for the platform auth module.
- **Events:** versioned event schemas + `EventPublisher` interface with an in-memory publisher (structured log emission). No message broker coupling.

## 5. Missing Modules → Required Contracts

| Dependency | Contract needed by Module 2 | Status |
|---|---|---|
| Module 1 Brand DNA | `GET /api/v1/brands/{brand_id}/dna` response schema + `BrandDNAClient` | `CONTRACT_PROPOSED` + `MOCK` adapter |
| Module 3 Entity | `EntityReference` DTO + `EntityProvider` | `CONTRACT_PROPOSED` + `MOCK` adapter |
| Module 3 Evidence | `EvidenceReference` DTO + `EvidenceProvider` | `CONTRACT_PROPOSED` + `MOCK` adapter |
| Module 4 Threat consumption | Module 2 exposes `GET /api/v1/threats/...` | `IMPLEMENTED` (Module 2 side) |

Module 2 does **not** create duplicate Entity/Brand/Evidence models — it references `entity_id`, `brand_id`, `evidence_id`, `source_id` as external UUID references (documented external-reference strategy, since shared tables do not exist yet).

## 6. Integration Risks

1. **Brand DNA schema drift** — Module 1 does not exist; when built, its real schema may differ from this contract proposal. Mitigation: adapter layer isolates schema translation to one class.
2. **Entity/Evidence schema drift** — same mitigation via `EntityProvider`/`EvidenceProvider`.
3. **Tenant model mismatch** — tenant identity source (header vs JWT claim) is TBD; isolated in `TenantContext` dependency.
4. **UUID mismatch** — contracts assume UUIDv4 identifiers; if other modules choose integer IDs, adapters must translate.
5. **Event schema mismatch** — Module 4 does not exist; event contracts are versioned from v1 and published through an interface.
6. **Async job semantics** — a future shared job system (Celery/Redis) may replace the in-process queue; behind `AnalysisJobQueue` interface.

## 7. Implementation Plan

Phase-by-phase per the master prompt (§42): contracts → schemas → models/migrations → adapters → ML layer → risk engine → pipeline services → jobs/queue/idempotency → events → API → tests → security/observability hardening → documentation → final validation. Each phase is verified by running imports/tests before proceeding.
