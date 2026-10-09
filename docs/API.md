# TRUSTGRAPH — API Reference

All examples below are **real responses captured from the running stack** (demo tenant
`11111111-2222-3333-4444-555555555555`). Module 2 and Module 3 also serve live
interactive OpenAPI docs at `http://localhost:8000/docs` and `http://localhost:8001/docs`.

## Conventions

- **Tenancy** — Module 2 and Module 3 require `X-Tenant-ID: <uuid>` on every request
  (missing header → `400 TENANT_REQUIRED`). Cross-tenant and missing lookups are both
  `404` (indistinguishable by design).
- **Idempotency** — Module 2's `POST /api/v1/analysis` accepts an `Idempotency-Key`
  header; replays return the original job.
- **Errors** — JSON bodies with machine-readable `error_code` / `error_message`; no
  stack traces are ever exposed to API consumers.
- **Timestamps** — ISO-8601 UTC.

---

## Module 2 — Risk engine (:8000)

### `POST /api/v1/analysis` — create an analysis job

```bash
curl -X POST http://localhost:8000/api/v1/analysis \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: 11111111-2222-3333-4444-555555555555" \
  -H "Idempotency-Key: demo-1" \
  -d '{"brand_id": "6dc4fadf-baaa-5ef7-8d67-8c9fa58786bb", "entity_id": "161a6131-cad9-4b08-9c8a-917686d2a671"}'
```

`brand_id` is a UUID (see [Brand UUID bridge](#brand-uuid-bridge)), `entity_id` is the
Module 3 entity UUID. Returns **202** with the job. Jobs run asynchronously
(`TRUSTGRAPH_WORKER_MODE=in_process`); the engine fetches the entity and its evidence
live from Module 3 and the Brand DNA from Module 1.

### `GET /api/v1/analysis/{job_id}` — poll a job

```json
{
  "job_id": "647e1966-4fc8-405d-b9f0-b1299b7d4e81",
  "status": "COMPLETED",
  "brand_id": "f453f161-00f9-581d-a4ff-7e3e6095332a",
  "entity_id": "9a518a63-c89f-4ca5-83ec-4a9d9a0b5eca",
  "created_at": "2026-10-09T18:55:45.592968Z",
  "started_at": "2026-10-09T18:55:45.600993Z",
  "completed_at": "2026-10-09T18:55:50.670437Z",
  "error_code": null,
  "error_message": null,
  "result": {
    "result_id": "28068710-75d9-45f6-9f6c-2d3ba69b61f1",
    "threat_id": "3c4011c5-746b-40e8-ba5e-e57b5fea3ff9",
    "risk_score": 15,
    "risk_level": "LOW",
    "classification": "UNKNOWN",
    "confidence": 0.4588542490181834,
    "evidence_count": 3,
    "analysis_timestamp": "2026-10-09T18:55:50.667580Z"
  }
}
```

`status`: `QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED`. On `FAILED`,
`error_code`/`error_message` carry the reason (e.g. `ENTITY_NOT_FOUND`). The console
polls this endpoint (1.5 s) with a 120 s client-side timeout and a "keep polling"
recovery.

> **`evidence_count` semantics** — it counts *citations*: `sum(len(f.evidence_ids) for
> f in risk_factors)` — an evidence item counts once per factor family it fed. In the
> example above, 2 distinct items produced 3 citations. The UI labels this explicitly;
> use the threat's `evidence_references` for distinct items.

### `GET /api/v1/threats` — threat register

Query: `status` (`OPEN|CONFIRMED|DISMISSED`), `risk_level`
(`LOW|MEDIUM|HIGH|CRITICAL`), `limit`, `offset`. Returns `{items, total, limit, offset}`.

### `GET /api/v1/threats/{threat_id}` — full verdict (captured live)

```json
{
  "threat_id": "8081fbeb-8634-46b9-b7fe-6c83a2b51c07",
  "tenant_id": "11111111-2222-3333-4444-555555555555",
  "brand_id": "6dc4fadf-baaa-5ef7-8d67-8c9fa58786bb",
  "entity_id": "161a6131-cad9-4b08-9c8a-917686d2a671",
  "risk_score": 36,
  "risk_level": "MEDIUM",
  "classification": "PHISHING",
  "confidence": 0.7110756688272454,
  "status": "OPEN",
  "model_version": "char_ngram_tfidf@1.0+phash_hamming@1.0+token_similarity@1.0",
  "risk_engine_version": "1.0.0",
  "analysis_timestamp": "2026-10-09T18:46:17.158137Z",
  "risk_factors": [
    {
      "factor_id": "ee0f3a7d-dac6-4817-bbb6-ad6e9c7bee46",
      "factor_type": "DOMAIN_SIGNALS",
      "score": 95,
      "weight": 0.15,
      "contribution": 14.25,
      "confidence": 1.0,
      "basis": "INFERRED",
      "evidence_ids": ["01ca6c91-3b5d-4869-8e57-9f3ddb79e6dd"]
    },
    {
      "factor_id": "d0ee867e-7c79-4795-9499-02ced5cf5064",
      "factor_type": "IDENTITY_SIMILARITY",
      "score": 48,
      "weight": 0.2,
      "contribution": 9.600000000000001,
      "confidence": 0.48333333333333334,
      "basis": "DERIVED",
      "evidence_ids": ["24feeaed-…", "01ca6c91-…", "68045cc6-…", "1aba2938-…"]
    }
  ],
  "evidence_references": [
    {
      "evidence_id": "01ca6c91-3b5d-4869-8e57-9f3ddb79e6dd",
      "source_id": "9c4f0990-d05b-43e3-99ba-fbe685d23089",
      "factor_types": ["DOMAIN_SIGNALS", "IDENTITY_SIMILARITY"]
    }
  ]
}
```

### `PATCH /api/v1/threats/{threat_id}/status` — analyst triage

Body `{"status": "CONFIRMED" | "DISMISSED" | "OPEN"}`. Re-analyzing the same
(brand, entity) pair upserts the same threat record — the register reflects the latest
verdict, and history lives in the analysis jobs/results.

### Health

- `GET /healthz` — liveness. `GET /readyz` — readiness incl. DB.

---

## Module 3 — Entity & Evidence (:8001)

### Entities

- `GET /api/v1/entities?limit=&offset=` → `{items, total, limit, offset}`
- `GET /api/v1/entities/{entity_id}` → entity (identifiers/attributes are string maps)
- `POST /api/v1/entities` — body `{"entity_type": "WEBSITE|SOCIAL_PROFILE|DOMAIN|MOBILE_APP|MESSAGING_ACCOUNT|OTHER", "display_name": "...", "identifiers": {"domain": "...", "handle": "..."}}`. Identifiers are normalized (trim + lowercase) at ingest.

### Evidence

- `GET /api/v1/entities/{entity_id}/evidence` → bare JSON list (this is the exact
  contract Module 2's HTTP adapter consumes), ordered by `collected_at`, then id:

```json
[
  {
    "evidence_id": "01ca6c91-3b5d-4869-8e57-9f3ddb79e6dd",
    "source_id": "9c4f0990-d05b-43e3-99ba-fbe685d23089",
    "entity_id": "161a6131-cad9-4b08-9c8a-917686d2a671",
    "evidence_type": "DOMAIN_INTEL",
    "collected_at": "2026-10-09T17:53:06.270858Z",
    "text": null,
    "image_hash": null,
    "url": "https://novapay-support.com/login",
    "metadata": {"days_since_registration": 9, "whois_privacy": true}
  }
]
```

- `POST /api/v1/entities/{entity_id}/evidence` — body requires `source_id` +
  `evidence_type` (`IDENTITY_MATCH | TEXT_CONTENT | VISUAL_ASSET | DOMAIN_INTEL |
  BEHAVIORAL_EVENT | REPUTATION_INTEL | RELATIONSHIP_LINK`) and at least one of
  `text` / `url` / `image_hash`; optional `metadata` map (the risk engine reads keys
  such as `days_since_registration`, `whois_privacy`, `recent_account_creation`,
  `brand_mimicry_in_bio`).

### Sources (provenance)

- `GET /api/v1/sources` → registry. `POST /api/v1/sources` — body requires `name` +
  `kind` (free string; fixtures use `fixture`). **Every evidence item must cite a
  source** — provenance is mandatory end-to-end.

### Health

- `GET /healthz`.

---

## Module 1 — Sentinel DRP (:3000)

Only consumed (read-only) by the TRUSTGRAPH console; Module 1 has its own full UI at
`http://localhost:3000` (scan experience, pipeline stages, Groq AI assessment — see
`module1/README.md`).

- `GET /api/brands` → protected brands with their **Brand DNA**:

```json
{
  "items": [
    {
      "id": "cmv19i3fz0000l4k68wq1z3bv",
      "name": "NovaPay",
      "officialDomains": ["novapay.com", "novapay.app"],
      "officialHandles": ["novapay", "novapaysupport"],
      "appDevelopers": ["NovaPay Inc."],
      "packagePrefixes": ["com.novapay"],
      "keywords": ["novapay", "nova pay", "novawallet"],
      "isDemo": true,
      "scanCount": 12
    }
  ]
}
```

- `GET /api/health` → `{status, database, intelMode, ai: {provider, configured, model}, providers}` —
  the console surfaces this honestly on the Overview page (e.g. "intel: demo · AI:
  template only" when `GROQ_API_KEY` is unset).

---

## Brand UUID bridge

Module 1 ids are cuids (`cmv19i3fz…`); Module 2 references brands by UUID. The console
derives the stable bridge id with `uuidv5(SENTINEL_BRAND_NAMESPACE, cuid)`
(`frontend/src/lib/brand-bridge.ts`, unit-tested):

| Module 1 brand | cuid | Module 2 `brand_id` |
|---|---|---|
| NovaPay | `cmv19i3fz0000l4k68wq1z3bv` | `6dc4fadf-baaa-5ef7-8d67-8c9fa58786bb` |
| ShopVerse | `cmv19i3g80001l4k6x0xeumyv` | `f453f161-00f9-581d-a4ff-7e3e6095332a` |

## Risk-scoring output, explained field by field

The engine (`risk_engine_version`, currently **1.0.0**) scores each of seven factor
families 0–100, multiplies by the family weight, and sums the contributions into
`risk_score` (0–100):

| `factor_type` | Weight | Scored from |
|---|---|---|
| `IDENTITY_SIMILARITY` | 0.20 | handle / domain / app-name similarity to Brand DNA |
| `VISUAL_SIMILARITY` | 0.20 | perceptual-hash (pHash) Hamming distance |
| `TEXT_SIMILARITY` | 0.15 | char n-gram TF-IDF cosine similarity |
| `DOMAIN_SIGNALS` | 0.15 | registration age, WHOIS privacy, lexical distance |
| `BEHAVIORAL_SIGNALS` | 0.10 | recent account creation, brand mimicry |
| `REPUTATION_SIGNALS` | 0.10 | threat-feed / blocklist floor |
| `RELATIONSHIP_SIGNALS` | 0.10 | links to other flagged entities |

- **`risk_level`** — `LOW ≤ 25 < MEDIUM ≤ 50 < HIGH ≤ 75 < CRITICAL`.
- **`classification`** — e.g. `PHISHING`, `IMPERSONATION`, `UNKNOWN` (no match).
- **`confidence`** (0–1) — evidence quality/coverage for the verdict; factors carry
  their own confidence and the engine combines them.
- **`basis`** (per factor) — `OBSERVED` (measured directly from evidence),
  `DERIVED` (computed from observations), `INFERRED` (model-derived). This preserves
  the observed-fact vs inference distinction end-to-end.
- **`contribution`** (per factor) — `score × weight`, the points that family added to
  the total. The threat-detail page renders the exact arithmetic.
- **`evidence_references`** — distinct evidence items with the factor families each
  fed, plus `source_id` for provenance resolution via Module 3.
- **`model_version`** — the ML model set that produced the factors
  (e.g. `char_ngram_tfidf@1.0+phash_hamming@1.0+token_similarity@1.0`).

Re-analysis of the same (brand, entity) upserts the threat; jobs and results keep the
audit trail. Full engineering detail: [modules/module-2/RISK_ENGINE.md](modules/module-2/RISK_ENGINE.md)
and [ML_ARCHITECTURE.md](modules/module-2/ML_ARCHITECTURE.md).
