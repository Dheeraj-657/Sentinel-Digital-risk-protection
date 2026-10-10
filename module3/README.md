# TRUSTGRAPH Module 3 — Minimum Viable Entity & Evidence Layer

Digital-intelligence service: tenants register **sources** (provenance),
ingest **entities** (impersonation candidates), and attach **evidence**.
Module 2 (the canonical risk engine, in `../backend`) consumes this
service over HTTP to score entities against Brand DNA.

STATUS: minimum viable implementation for the 2026-10-10 deadline. It
implements only the retrieval contract Module 2 needs plus the minimum
ingestion surface to populate it. Discovery/collection connectors are
out of scope — **no live discovery results are invented**; fixtures are
seeded and clearly labelled `SYNTHETIC TEST_ONLY`.

## Wire contract (what Module 2 consumes)

- `GET /api/v1/entities/{entity_id}` → EntityReference JSON
- `GET /api/v1/entities/{entity_id}/evidence` → **bare JSON list** of
  EvidenceReference, ordered by `collected_at`, `evidence_id`
- All endpoints require header `X-Tenant-ID: <uuid>` (else 400 TENANT_REQUIRED)
- Missing vs cross-tenant lookups are indistinguishable (404 NOT_FOUND)

Drift against Module 2's pydantic schemas is gated by
`tests/test_contract_parity.py`, which validates this service's actual
HTTP JSON with `app.schemas.entity.EntityReference` /
`EvidenceReference` (test-time only — no runtime dependency on `app`).

## Ingestion API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/sources` | 201; name (1–200), kind (1–100) |
| POST | `/api/v1/entities` | 201; optional client-supplied `entity_id`; 409 DUPLICATE_ENTITY on clash; identifiers normalized (domain/handle) |
| POST | `/api/v1/entities/{entity_id}/evidence` | 201; `collected_at` defaults to now (UTC) |
| GET | `/api/v1/entities/{entity_id}` | 404 if missing or cross-tenant |
| GET | `/api/v1/entities/{entity_id}/evidence` | bare list; 404 if missing or cross-tenant |
| GET | `/healthz` | liveness |

Errors use the shared envelope `{"error_code", "message", "details"}`;
internal stack traces never reach responses (500 logs them server-side).

## Normalization layer

`module3/normalization.py` cleans identifiers at ingestion (lowercase;
strip URL scheme/path/port/leading `www.` for domains; strip leading
`@` for handles) but deliberately does **not** interpret them —
registrable-domain collapse happens in Module 2's comparison layer,
which re-normalizes on its side.

## Setup

```bash
# from the repository root, using the backend venv
python -m pip install -e module3

cd module3
python -m alembic upgrade head        # creates module3.db
python -m pytest                       # module3 test suite
```

To run the contract-parity tests, the `app` (Module 2) package must be
importable in the same interpreter; otherwise those tests skip.

## Serving

```bash
cd module3
python -m uvicorn module3.main:app --port 8001
```

Then point Module 2 at it: `TRUSTGRAPH_MODULE3_BASE_URL=http://localhost:8001`
(see `backend/.env`). Module 2 needs **zero code changes** — its
`HTTPModule3Client` already speaks this contract.

## Synthetic fixtures (SYNTHETIC TEST_ONLY)

```bash
python -m module3.seed <tenant-uuid>
```

Idempotent (uuid5-derived ids). Seeds one source, one entity
(`WEBSITE`, domain `acme-support.com`, handle `acme_help`) and four
evidence items (TEXT_CONTENT, VISUAL_ASSET, DOMAIN_INTEL with
`days_since_registration: 12` / `whois_privacy: true`, BEHAVIORAL_EVENT
with `recent_account_creation: true` / `brand_mimicry_in_bio: true`) —
mirroring Module 2's documented impersonation example. Every record is
labelled `SYNTHETIC TEST_ONLY`; this is fixture data, not real
threat intelligence.

## Layout

```
module3/
  pyproject.toml        # standalone package (own deps; no config merge)
  module3/             # config, errors, schemas, models, normalization,
                        # database, api, main, seed
  alembic/              # initial migration e7d2a9c4b1f3
  tests/                # normalization, api, seed, contract parity
```
