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

### `GET /api/v1/analysis` — analysis job history

Query: `status` (`QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED`, optional), `limit`
(1–200, default 50), `offset`. Newest first. Returns `{items, total, limit, offset}`,
where each item is a compact job summary (job_id, status, brand_id, entity_id,
created/started/completed timestamps, error_code, and — for completed jobs — the
`threat_id` the run produced, resolved from its latest `AnalysisResult`):

```json
{
  "items": [
    {
      "job_id": "4a214855-635f-4669-ba29-c67ca0caa9b6",
      "status": "COMPLETED",
      "brand_id": "b29b68f9-bb55-5d15-9883-ac36fbc3f57b",
      "entity_id": "1f6768c8-ecb0-4a53-8c29-87c1f2993f32",
      "created_at": "2026-10-09T21:51:41.508419Z",
      "started_at": "2026-10-09T21:51:41.517810Z",
      "completed_at": "2026-10-09T21:51:46.442270Z",
      "error_code": null,
      "threat_id": "9dfedae1-fc7b-4b29-b02d-37a235b82cf5"
    }
  ],
  "total": 7,
  "limit": 2,
  "offset": 0
}
```

This is a thin read-only route over the existing `JobService.list_for_tenant` — no
engine or job-state logic is touched. The console's Analysis history page uses it.

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

## Module 4 — AI Security Analyst (served by Module 2, :8000)

Isolated package `backend/app/module4/`; requires `X-Tenant-ID` like every Module 2 route. Read-only: it never scores, writes threats or performs actions.

### `POST /api/v1/investigation/analyst`

```json
{
  "question": "Why was this entity classified as medium risk?",
  "threat_id": "7a250d38-…",          // threat_id and/or entity_id (entity → its highest verdict)
  "entity_id": "161a6131-…",
  "compare_threat_id": null,           // optional second verdict ("Compare two reports")
  "cluster_threat_ids": [],            // optional ≤ 12 verdicts → "potential campaign" summary
  "history": [{"role": "user", "content": "…"}]   // ≤ 8 turns, last 6 forwarded
}
```

`cluster_threat_ids` (or a question mentioning a campaign/cluster) produces intent `campaign`:
members are grouped **only** through the stored exact-match relations between them; members
with no shared identifier are named as not linked; the answer always says it is a candidate
grouping, not a confirmed campaign. Every member is tenant-checked (one foreign id → 404).
`compare_threat_id` and `cluster_threat_ids` are mutually exclusive (422).

Response:

```json
{
  "answer": "… rated MEDIUM risk … [threat:7a250d38-…] … [ev:01ca6c91-…]",
  "intent": "why",                      // why | evidence | relations | next_steps | compare | campaign | summary
  "source": "GROQ",                     // or TEMPLATE (no key, provider failure, or grounding rejection)
  "model": "openai/gpt-oss-120b",
  "citations": {"evidence_ids": [], "threat_ids": [], "entity_ids": []},
  "context": {"threat_ids": [], "entity_ids": [], "evidence_count": 4, "related_count": 2,
              "brand_names": ["NovaPay"], "missing": []},
  "limitations": [], "notes": [], "generated_at": "…"
}
```

Errors: `400 TENANT_REQUIRED`, `404 NOT_FOUND` (unknown or cross-tenant threat/entity), `422 VALIDATION_ERROR` (no subject, or threat not belonging to entity). Grounding rules: see [MODULE4.md](MODULE4.md#2-backend-change-isolated-additive); a model answer that asserts a confirmed campaign is also rejected (negated wording such as "not a confirmed campaign" is allowed).

### `GET /api/v1/investigation/analyst/status`

`{"llm_provider": "groq", "llm_configured": false, "model": "openai/gpt-oss-120b", "grounding": "…"}` (never the key).

## Module 3 — Entity & Evidence (:8001)

### Entities

- `GET /api/v1/entities?entity_type=&q=&limit=&offset=` → `{items, total, limit,
  offset}`, newest first. `entity_type` filters on the enum below; `q` (≤200 chars) is
  a case-insensitive substring match against `display_name` and the `domain` /
  `handle` identifiers.
- `GET /api/v1/entities/{entity_id}` → entity (identifiers/attributes are string maps)
- `POST /api/v1/entities` — body `{"entity_type": "WEBSITE|SOCIAL_PROFILE|DOMAIN|MOBILE_APP|MESSAGING_ACCOUNT|OTHER", "display_name": "...", "identifiers": {"domain": "...", "handle": "..."}}`. Identifiers are normalized (trim + lowercase) at ingest.

  **Deduplication.** Reusing an exact `entity_id` → `409 DUPLICATE_ENTITY` with
  `details.entity_id`. Registering the same `domain` for the same tenant *and* entity
  type under a different id → `409 DUPLICATE_ENTITY` with
  `details.existing_entity_id` pointing at the entity that already owns the domain:

  ```json
  {
    "error_code": "DUPLICATE_ENTITY",
    "message": "An entity with domain 'novapay-support.example' already exists for this tenant and type.",
    "details": {"existing_entity_id": "161a6131-cad9-4b08-9c8a-917686d2a671"}
  }
  ```

- `PATCH /api/v1/entities/{entity_id}` — partial update: `display_name` (1–300 chars,
  stripped), `identifiers` (re-normalized on write), `attributes`. Omitted / `null`
  fields are left unchanged; unknown keys and `entity_type` → `422` (the type is
  immutable). Returns the updated entity list item.

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
  `brand_mimicry_in_bio`). `url`, when present, must be an absolute `http(s)://` URL
  (≤ 2048 chars); `javascript:`, `data:`, `file:` and scheme-relative values → **422**.

### Sources (provenance)

- `GET /api/v1/sources` → registry. `POST /api/v1/sources` — body requires `name` +
  `kind` (free string; fixtures use `fixture`). **Every evidence item must cite a
  source** — provenance is mandatory end-to-end.

### Health

- `GET /healthz`.

---

## Console dev proxy (:5173)

The console calls all three services through Vite's proxy (one origin, no CORS). When an
upstream module is not running the proxy answers **502** with
`{"error_code": "SERVICE_UNAVAILABLE", "message": "<Service> is not reachable at <url> …"}`
so the UI can say which module is down.

## Module 1 — Sentinel DRP (:3000)

Consumed by the TRUSTGRAPH console for brand intelligence and the Sentinel scan
experience; Module 1 also has its own full UI at `http://localhost:3000` (scan
experience, pipeline stages, Groq AI assessment — see `module1/README.md`). Module 1
has no tenancy model — these routes are unauthenticated in local dev.

### Brands

- `GET /api/brands` → protected brands with their **Brand DNA**:

```json
{
  "items": [
    {
      "id": "cmv1bm2y30000gsk6z25z7wop",
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

- `POST /api/brands` — create a brand. Body is the Brand DNA fields (`name` 2–80
  chars; list fields ≤20 entries each); input is normalized (domains/handles stripped
  of scheme, path, `www.`, `@`; lowercased). `409 BRAND_EXISTS` on a duplicate name.
- `GET /api/brands/{id}` → single brand (the console's brand detail page).
- `PATCH /api/brands/{id}` — edit Brand DNA. Same schema/normalization as create;
  omitted fields are unchanged. `404 NOT_FOUND` for unknown ids, `400 DEMO_BRAND` for
  seeded demo brands (demo brands are read-only).
- `DELETE /api/brands/{id}` — delete a brand; its scans have `brandId` set to null
  (history is preserved). `404 NOT_FOUND`, `400 DEMO_BRAND`.

### Scans

- `POST /api/scans` — run a Sentinel scan and store the report. Body:
  `{"entityType": "PROFILE|WEBSITE|DOMAIN|APP", "input": "...", "brandId": "..." or
  "brand": {...}, "claimedDeveloper": "..."}` (input 3–2048 chars; rate-limited to 12
  scans/min per client IP → `429 RATE_LIMITED` with `retryAfterSec`). Returns **201**
  with the full `AnalysisReport` plus its `id`. Targets on loopback, private, link-local
  (incl. `169.254.169.254`), CGNAT, multicast or reserved addresses — in any spelling
  (`0x7f000001`, `2130706433`, `[::ffff:7f00:1]`, `localhost`, `*.internal`) — are
  rejected with **400** `INVALID_ENTITY`. In `INTEL_MODE=live` every fetch hop is
  re-validated (http/https only, no credentials, pinned DNS answer; see
  `src/lib/engine/net-guard.ts`).
- `GET /api/scans?type=&level=&q=&target=&brand=&limit=&cursor=` → scan history,
  `{items, nextCursor, total}`. `type` (`PROFILE|WEBSITE|DOMAIN|APP`), `level`
  (`VERY_LOW|LOW|MEDIUM|HIGH|CRITICAL`), `q` (≤200), `target` (≤300), `brand` (cuid —
  brand-scoped history for the brand detail page), `limit` 1–100, opaque `cursor`.
- `GET /api/scans/{id}` → `{report, history}` — the full report plus up to 12 earlier
  scans of the same target for risk-over-time.
- `DELETE /api/scans/{id}` → 204.

### Stats & health

- `GET /api/stats` → aggregate scan statistics (`total`, `levels`, `byType`,
  `avgRisk`, `avgConfidence`, `recentHigh`, `recent`, `topSignals`). The console
  dashboard renders these server-side numbers directly.
- `GET /api/health` → `{status, database, intelMode, ai: {provider, configured, model}, providers}` —
  the console surfaces this honestly on the Overview page (e.g. "intel: demo · AI:
  template only" when `GROQ_API_KEY` is unset).

---

## Brand UUID bridge

Module 1 ids are cuids (`cmv1bm2y3…`); Module 2 references brands by UUID. The console
derives the stable bridge id with `uuidv5(SENTINEL_BRAND_NAMESPACE, cuid)`
(`frontend/src/lib/brand-bridge.ts`, unit-tested), where
`SENTINEL_BRAND_NAMESPACE = uuidv5(NAMESPACE_DNS, "trustgraph.module1.sentinel")`:

| Module 1 brand | cuid | Module 2 `brand_id` |
|---|---|---|
| NovaPay (demo) | `cmv1bm2y30000gsk6z25z7wop` | `86307798-36b3-57f3-afa5-cc8150169a59` |
| ShopVerse (demo) | `cmv1bm2ye0001gsk6o51p946h` | `f4626c30-f514-594d-9a55-e00a9b7837b0` |
| Globex Financial | `cmv1hrjyt0000bkk601u9bcar` | `27fef6b2-f573-566d-8e37-dfa7d0bb7369` |
| Initech Systems | `cmv1hs5zi0001bkk6bg0u2jf5` | `b29b68f9-bb55-5d15-9883-ac36fbc3f57b` |

(cuids shown are from the current seeded database — the bridge is computed from
whatever brands exist, so newly created brands map the same way.)

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
- **`classification`** — `PHISHING`, `BRAND_IMPERSONATION`, `SUSPICIOUS_DOMAIN`, or
  `UNKNOWN` (no match). Priority: PHISHING → BRAND_IMPERSONATION → SUSPICIOUS_DOMAIN →
  UNKNOWN.
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
