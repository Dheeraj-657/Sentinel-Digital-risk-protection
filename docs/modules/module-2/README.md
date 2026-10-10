# TRUSTGRAPH Module 2 — AI Threat Detection & Risk Engine

Explainable AI risk analysis of digital entities against Brand DNA. Module 2
receives an entity from Module 3, compares it against canonical Brand DNA from
Module 1, and produces an integer risk score (0–100) decomposed into weighted,
evidence-citing factors. It never decides "is this a threat?" with an opaque
model — every score is recomputable from persisted factors.

- Service version: `1.0.0` (`app/main.py` SERVICE_VERSION)
- Risk engine version: `1.0.0` (`app/risk/config.py` ENGINE_VERSION)
- Model version string: `char_ngram_tfidf@1.0+phash_hamming@1.0+token_similarity@1.0`
- Stack: Python ≥3.11, FastAPI, Pydantic v2, SQLAlchemy 2.x, Alembic, pytest

## Status labels used everywhere in this repo

| Label | Meaning |
|---|---|
| IMPLEMENTED | Real code, exercised by the test suite. |
| CONTRACT_ONLY | Interface/DTO exists; the counterpart module does not exist in this repository. |
| CONTRACT_PROPOSED | The DTO shape is our proposal; when the owning module ships, ITS contract wins and this schema is adapted. |
| MOCK | Synthetic in-memory stand-in for tests/local dev only — never presented as real data. |
| EXTERNAL_DEPENDENCY | Requires a component outside this repository (Module 1/3 services, a broker, scikit-learn, PostgreSQL). |
| TBD | Deliberately deferred; nothing fake was built in its place. |

## Repository reality (do not skip this)

Modules 1 (Brand Intelligence), 3 (Digital Intelligence / Entity & Evidence),
and 4 (Investigation) DO NOT EXIST in this repository. Module 2 was built
against interfaces with labeled adapters and mocks. See
[INTEGRATION_MATRIX.md](INTEGRATION_MATRIX.md) and
[REPOSITORY_ASSESSMENT.md](REPOSITORY_ASSESSMENT.md) for the per-dependency
truth. Nothing in this repository fabricates Module 1/3/4 behavior as
"production".

## What is implemented vs. not (summary)

| Capability | Status |
|---|---|
| Analysis pipeline (normalize → extract → score → classify → persist → publish) | IMPLEMENTED |
| Risk engine (weights, thresholds, confidence, integer 0–100) | IMPLEMENTED |
| Deterministic classification (PHISHING / BRAND_IMPERSONATION / SUSPICIOUS_DOMAIN / UNKNOWN) | IMPLEMENTED |
| Idempotent job submission (Idempotency-Key semantics) | IMPLEMENTED |
| Job queue (sync + in-process asyncio; broker swap point) | IMPLEMENTED (transport MOCK-ish, durability EXTERNAL_DEPENDENCY) |
| Threat lifecycle (OPEN ⇄ CONFIRMED / DISMISSED) | IMPLEMENTED |
| Versioned domain events via EventPublisher | IMPLEMENTED (in-memory/log publishers; broker publisher EXTERNAL_DEPENDENCY) |
| HTTP adapters to Module 1 / Module 3 | IMPLEMENTED (interfaces CONTRACT_ONLY against real upstreams) |
| Brand DNA / Entity / Evidence DTOs | CONTRACT_PROPOSED |
| Scraping, ingestion, auth/identity management, notifications | OUT OF SCOPE (owned by other modules) — never built |

## Quick start

```bash
cd backend
pip install -e ".[dev]"          # add [ml] for the optional scikit-learn adapter
alembic upgrade head             # apply schema (SQLite by default)
uvicorn app.main:app --reload    # http://127.0.0.1:8000/docs
python -m pytest tests/          # 93 tests, all passing as of 2026-10-08
```

Without `TRUSTGRAPH_MODULE1_BASE_URL` / `TRUSTGRAPH_MODULE3_BASE_URL` the app
binds MOCK adapters and logs `mock_integrations: true` at startup — that
deployment is explicitly a contract/dev environment, never production intel.

## Documentation index

| Document | Contents |
|---|---|
| [LLD.md](LLD.md) | Low-level design, module map, Mermaid diagrams |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, boundaries, DI, request/job lifecycle |
| [API_CONTRACT.md](API_CONTRACT.md) | Every endpoint, envelope, error codes |
| [DATA_MODEL.md](DATA_MODEL.md) | Tables, columns, constraints, indexes |
| [EVENTS.md](EVENTS.md) | Event schemas, envelope, publisher boundary |
| [RISK_ENGINE.md](RISK_ENGINE.md) | Math, weights, thresholds, classification rules |
| [ML_ARCHITECTURE.md](ML_ARCHITECTURE.md) | Model interfaces, baseline models, registry |
| [SECURITY.md](SECURITY.md) | Tenant isolation, error hygiene, data minimization |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Logging, correlation IDs, metrics, health |
| [TESTING.md](TESTING.md) | Suite layout, fixtures, how to run |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Configuration, worker modes, migrations |
| [INTEGRATION_MATRIX.md](INTEGRATION_MATRIX.md) | Per-dependency status of Module 1/3/4 touchpoints |
| [INTEGRATION_CONFLICT_ANALYSIS.md](INTEGRATION_CONFLICT_ANALYSIS.md) | Where our proposed contracts may collide with future modules |
| [REPOSITORY_ASSESSMENT.md](REPOSITORY_ASSESSMENT.md) | Phase 1 findings (repo was empty; modules 1/3/4 absent) |
