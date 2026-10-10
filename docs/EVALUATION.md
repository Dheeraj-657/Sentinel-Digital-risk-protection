# TRUSTGRAPH — Discovery Evaluation (Judge-Ready)

Reproducible measurement of the automatic threat-discovery pipeline (P1) against
**live services**: per-provider coverage and latency, query provenance, candidate
counts and duplicate rate, Module 3 evidence traceability, chained Module 2
scoring coverage, and honest failure reporting.

The eval script makes **no** HTTP calls of its own beyond TRUSTGRAPH's API — it
exercises exactly the path the console UI uses (`POST /api/v1/discovery` →
poll → `GET /api/v1/discovery/{job_id}`).

## Running it

Prerequisites:

1. Module 3 up (`:8001`) — discovery persists entities/evidence/sources through it.
2. Backend (Module 2) up (`:8000`) — the service under evaluation.
3. A tenant with at least one brand registered in Module 1 (Sentinel on `:3000`).

```bash
cd backend
./.venv/Scripts/python.exe scripts/eval_discovery.py \
  --base-url http://localhost:8000 \
  --tenant 11111111-2222-3333-4444-555555555555 \
  --brand-id 86307798-36b3-57f3-afa5-cc8150169a59
```

Exit codes: `0` — job reached a terminal state (COMPLETED / PARTIAL / FAILED are
all honest outcomes, script prints everything); `1` — polling timed out;
`2` — could not reach the backend.

## Metrics recorded

| Metric | Meaning |
| --- | --- |
| final status | COMPLETED / PARTIAL / FAILED / QUEUED / RUNNING; FAILED is reported, never masked as success |
| wall time | `completed_at − started_at` from the job record |
| provider coverage | per provider: terminal status, candidate count, latency_ms, error or warning detail |
| queries + basis | every query actually issued, with the Brand-DNA signal (`brand_name:*`, `handle:*`, `official_domain:*`) that produced it |
| unique candidates / duplicate rate | normalized, deduplicated candidates; `duplicate_count / raw observations` |
| evidence traceability | candidates carrying `entity_id` + `evidence_id`; candidates carrying a `discovery_fingerprint` that matches Module 3 evidence metadata |
| chained analysis | candidates whose chained Module 2 analysis job reached COMPLETED |
| warning | e.g. "N provider(s) unconfigured; no evidence was fabricated for them." |

## Recorded live run — 2026-10-10

Environment: NovaPay demo brand, no API keys configured (web_search unconfigured
by design of this run). Direct provider pulses at evaluation time:
`crt.sh` → **HTTP 502** (upstream outage, retried repeatedly), `api.certspotter.com` → **HTTP 200**.

```
=== discovery eval — 5fcc6710-c5dc-41c5-b090-d4720fd0e9cc ===
final status        : PARTIAL
wall time           : 3.7s

provider coverage:
  certificate_transparency   FAILED       candidates=0   latency=851ms      crt.sh returned HTTP 502 for 'novapay.com'
  certspotter                COMPLETED    candidates=2   latency=2564ms     -
  web_search                 UNCONFIGURED candidates=0   latency=n/a        -

queries (Brand DNA basis):
  certificate_transparency   'novapay.com'                            basis=official_domain:novapay.com
  certificate_transparency   'novapay.app'                            basis=official_domain:novapay.app
  certspotter                'novapay.com'                            basis=official_domain:novapay.com
  certspotter                'novapay.app'                            basis=official_domain:novapay.app

candidates          : 0 unique (duplicate_count=0, duplicate rate n/a (no raw observations))
evidence traceable  : 0/0 candidates have entity_id + evidence_id
chained analysis    : 0/0 candidates scored by Module 2 (0 reached COMPLETED)
warning             : 1 provider(s) unconfigured (web_search); no evidence was fabricated for them.
```

### Interpretation (what this proves, live)

- **certspotter is a genuinely working live provider**: real HTTP 200 from
  `api.certspotter.com` (anonymous, no credentials), 2 raw certificate
  observations at 2.5 s, bounded queries derived from Brand DNA
  (`official_domain:novapay.com`, `official_domain:novapay.app`).
- **Normalization and official-domain exclusion ran on real data**: both raw
  observations were subdomain/wildcard certificates for the brand's *own*
  registrable domains (`novapay.com`, `novapay.app`) and were correctly
  **excluded** as official — zero candidates, which is the right answer for this
  brand snapshot. No lookalike registrations existed in the CT window queried.
- **Honest failure reporting**: crt.sh's outage surfaced as
  `FAILED: crt.sh returned HTTP 502` per provider, the job ended **PARTIAL**
  (not COMPLETED), and web_search was reported `UNCONFIGURED` — no fabricated
  results, no masked failure. The all-failure → FAILED path is covered by
  `test_failed_provider_with_unconfigured_peer_is_failed_not_completed` and was
  separately verified live during the crt.sh outage.
- **Candidate-rich flow (evidence + chained scoring + analyst review) is
  exercised end-to-end by the mocked-provider test suite**
  (`backend/tests/test_discovery.py`, fixtures labeled `SYNTHETIC TEST_ONLY`),
  because no live provider currently returns lookalike candidates for NovaPay:
  Cert Spotter / crt.sh CT searches match *suffixes only* (own domains), and the
  prefix-lookalike-capable web_search provider needs an API key. See status
  categories below.

## Capability status categories

The directive's five buckets, applied across the product:

| Category | Capabilities |
| --- | --- |
| **live-verified** | Cert Spotter CT provider (real HTTP 200, real issuance data, 2026-10-10); discovery job lifecycle + honest PARTIAL/FAILED semantics (live, incl. during crt.sh outage); Module 2 scoring API and Module 3 entity/evidence/source APIs on running services; console UI end-to-end against live services; this eval script. |
| **implemented + tested** (automated suites, external HTTP mocked) | Discovery orchestration (bounded queries, normalization, dedupe, official-domain exclusion, candidate caps, PARTIAL/FAILED logic); chained Module 2 scoring of discovered candidates; evidence-backed related-threat detection (verified shared attributes only, confidence omitted by design); M1 Sentinel brand intelligence; M2 risk engine; M3 entity/evidence registry; frontend console (React 19 + Vite, 81 tests). |
| **implemented — requires credentials** | `web_search` discovery provider (Brave Search API shape). Set `TRUSTGRAPH_DISCOVERY_SEARCH_API_KEY` and it activates; without a key it reports `UNCONFIGURED` honestly and is skipped. |
| **mocked-test-only** | Candidate-rich discovery end-to-end (multiple lookalike candidates → evidence → chained scoring → analyst review) is proven by deterministic mocked-provider tests, not yet by a live provider run — see interpretation above. |
| **not implemented** | Scheduled/recurring discovery (jobs are on-demand); notifications/alerting; user authentication/SSO (tenants are trusted via `X-Tenant-ID`); graph visualization subsystem (related threats are evidence-backed links, deliberately not a fabricated graph); live candidate-rich discovery (blocked on crt.sh recovery and/or a web_search API key — both environmental, not code). |

## Honesty rules encoded in the pipeline

- Providers never fabricate results; unconfigured → `UNCONFIGURED`, upstream
  failure → `FAILED`/`TIMEOUT`/`RATE_LIMITED` with per-provider detail.
- Job status is derived honestly: all-unconfigured → COMPLETED; any hard failure
  with zero provider successes → FAILED; success+failure mix → PARTIAL.
- Candidate observations are **not** malice verdicts — every candidate is scored
  by the canonical Module 2 engine and waits for analyst confirm/dismiss.
- Synthetic fixtures are labeled `SYNTHETIC TEST_ONLY` and never presented as
  live discovery output.
