# TRUSTGRAPH — Test & Build Report

All results below were captured on **2026-10-09/10 (Windows 10, Node 24.18, Python
3.13)** by re-running every command immediately before submission. Commands are
PowerShell, run from the module's directory.

## Summary

| # | Suite | Command | Result |
|---|---|---|---|
| 1 | Frontend types | `npm run typecheck` | **clean** (TypeScript 5.9, strict) |
| 2 | Frontend unit tests | `npm run test` | **83/83 passed** (10 test files) |
| 3 | Frontend production build | `npm run build` | **✓ built in ~1.8 s** |
| 4 | Module 2 risk engine | `python -m pytest` | **148/148 passed** (0 failures, 0 errors, 0 skipped) |
| 5 | Module 3 evidence store | `python -m pytest` | **92/92 passed** (0 failures, 0 errors, 0 skipped) |
| 6 | Module 1 types | `npm run typecheck` | **clean** |
| 7 | Module 1 brand API checks | `npm run test:brands` | **all checks passed** |
| 8 | Module 1 engine self-check | `npm run test:engine` | **all engine checks passed** |

## Commands and captured output

### Frontend (`cd frontend`)

```powershell
npm run typecheck   # tsc --noEmit → no output, exit 0
npm run test        # vitest run
npm run build       # tsc --noEmit && vite build
```

```
 ✓ src/lib/format.test.ts (9 tests)
 ✓ src/lib/brand-bridge.test.ts (8 tests)
 ✓ src/lib/api.test.ts (25 tests)
 ✓ src/components/threat-table.test.tsx (1 test)
 ✓ src/pages/analysis-history.test.tsx (3 tests)
 ✓ src/pages/sources.test.tsx (5 tests)
 ✓ src/pages/scan-pages.test.tsx (8 tests)
 ✓ src/pages/console-workflows.test.tsx (6 tests)
 ✓ src/pages/console-interactive.test.tsx (7 tests)
 ✓ src/pages/discovery-pages.test.tsx (11 tests)

 Test Files  10 passed (10)
      Tests  83 passed (83)
```

Build output: `dist/assets/index-*.js 405.18 kB │ gzip 116.08 kB — ✓ built in 1.82s`
(self-hosted variable fonts; no runtime errors in the browser console during the
E2E walkthroughs).

### Module 2 — risk engine (`cd backend`, venv active)

```powershell
python -m pytest
```

148 progress dots, then `148 passed` — verified via JUnit XML for an authoritative
count:

```
M2 tests=148 failures=0 errors=0 skipped=0
```

Covers: schema validation, scoring math (weights, levels, confidence), job lifecycle
(queued/running/completed/failed/cancelled), idempotency keys, tenant isolation,
Module 1/3 HTTP adapters (real FastAPI test doubles over the actual wire contract),
threat register/status transitions, API error semantics, the `GET /api/v1/analysis`
job-history route, **automatic threat discovery (`tests/test_discovery.py`, 20
tests: bounded Brand-DNA queries, provider success/empty/timeout/rate-limit/
unconfigured outcomes, normalization + dedup, evidence provenance, chained
canonical scoring, honest `PARTIAL`/`FAILED` reporting, tenant isolation) and
evidence-backed related threats (`tests/test_relations.py`, 9 tests: exact
stored-attribute matching only, cross-tenant skips surfaced as warnings, no
name-similarity relations)**. The documented floor is **113 passing** — the
current run exceeds it (113 preserved + 35 new); frozen scoring tests are
untouched. pytest emits dependency deprecation **warnings** (no failures);
counts above exclude none.

### Module 3 — entity & evidence (`cd module3`, venv active)

```powershell
python -m pytest
```

```
M3 tests=92 failures=0 errors=0 skipped=0
```

Covers: normalization on ingest, required-field validation, source-provenance
enforcement, tenant scoping (cross-tenant = 404), pagination,
`test_contract_parity.py` (validates this service's actual HTTP JSON against
Module 2's pydantic `EntityReference`/`EvidenceReference` schemas so the wire
contract cannot drift), **plus the completion additions: `PATCH
/api/v1/entities/{id}` partial update semantics (unknown keys 422, immutable
entity_type, None = unchanged), `entity_type`/`q` list filters, and natural-key
dedup (`409 DUPLICATE_ENTITY` with `existing_entity_id`)**.

### Module 1 — Sentinel DRP (`cd module1`)

```powershell
npm run typecheck    # tsc --noEmit → clean
npm run test:brands  # brand-input + brand-API checks (pure functions)
npm run test:engine
```

`test:brands` exercises the brand create/edit input layer (`brandInputSchema` +
`normalizeBrandInput` + Prisma payload mapping):

```
✔ name trimmed — "Acme"
✔ domains canonical — ["acme.com"]
✔ handles canonical — ["acme_help"]
✔ developers preserved — ["Acme Ltd"]
✔ prefixes lowercased — ["com.acme"]
✔ keywords lowercased — ["acme"]
✔ no id leakage into prisma data
✔ multi-line list splits — ["a.com","b.com","c.com"]
✔ missing name rejected
✔ 1-char name rejected

All brand-input checks passed
```

Engine self-check runs every sample entity through the engine and asserts expected
risk bands, input validation, and the AI grounding guard (invented numbers,
contradicted levels, and uncited findings are all rejected):

```
✔ rejects APP "hello" — Enter a package name like com.brand.app, …
✔ grounding: grounded output accepted
✔ grounding: invented number rejected (…)
✔ grounding: wrong level rejected (…)
✔ grounding: uncited findings rejected (…)
All engine checks passed
```

## End-to-end verification (through the running UI, not mocks)

### Walkthrough 1 — full analysis flow (2026-10-09)

Executed against the full stack (M1 :3000, M2 :8000, M3 :8001, console :5173), demo
tenant `11111111-…-5555`:

1. **Health** — all three modules reported healthy through the console's dev proxy
   (`/api/health`, `/readyz`, `/healthz`); Overview page rendered live module status
   including honest disclosure ("intel: demo · AI: template only").
2. **Register entity** — `ShopVerse Prize Portal (SYNTHETIC TEST_ONLY)`
   (`9a518a63-c89f-4ca5-83ec-4a9d9a0b5eca`, domain `shopverse-prize-portal.example`,
   handle `shopverse_prizes`) via the UI form → 201 from Module 3.
3. **Create source + attach evidence** — source `synthetic-console-e2e (SYNTHETIC
   TEST_ONLY)`; `TEXT_CONTENT` (prize-scam text) and `DOMAIN_INTEL`
   (`https://shopverse-prize-portal.example/claim`) via the UI form. Evidence
   timeline and source counts update correctly.
4. **Run analysis** — ShopVerse (derived UUID `f4626c30-…`) vs the entity; job
   `647e1966-4fc8-405d-b9f0-b1299b7d4e81` → `COMPLETED` in ~5 s
   (score **15/100 LOW**, Unclassified, confidence 46%).
5. **Threat detail** — factor rows with points/weights/confidence/basis, evidence
   provenance resolved from Module 3 with real ids, generated explanation,
   synthetic-data disclosure, suggested next steps.
6. **Register propagation** — Overview and Threat register both list the new threat;
   filters/sort/search exercised.
7. **Network/console hygiene** — all browser requests returned 200/304; console
   showed no errors.

### Walkthrough 2 — completion features, multi-brand (2026-10-10)

Same stack, same tenant, every step through the console UI:

1. **Brand CRUD** — created **Globex Financial** and **Initech Systems** via the
   Brands page form (Brand DNA: domains, handles, developers, prefixes, keywords);
   edited a non-demo brand's DNA through the edit form and verified the round-trip
   (values persisted after reload); demo brands correctly refuse edit/delete
   (`DEMO_BRAND`).
2. **Console scan** — ran a Sentinel scan from the console's new **New scan** page
   against the Initech brand; **Scans** list shows the scan, the risk-level filter
   works (Critical filter → 4 rows; Clear resets), and the scan detail page renders
   the full report with risk-over-time history. The Initech scan
   (`cmv1i4chd0002bkk6uvcpuxsl`) scores **30/100 LOW** vs brand Initech Systems.
3. **Entity edit** — edited an entity's display name and identifiers through the
   entity detail form (PATCH round-trip verified); entity list search + type filter
   exercised.
4. **Multi-brand analysis** — ran analysis jobs for both new brands: Globex job
   `d5cbdb7a-…` and Initech job `4a214855-…`, both `COMPLETED`; threats
   `a9fb1818-…` (21/100 LOW, Globex) and `9dfedae1-…` (23/100 LOW, Initech) appear
   in the register alongside the NovaPay fixture (36/100 MEDIUM, Phishing).
5. **Analysis history** — the new `/analysis/history` page lists all 7 jobs with the
   status filter and links to each job/threat.
6. **Dashboard stats** — Overview now renders Module 1 `/api/stats` server-side
   numbers (SCANS 15, avg risk 42 · avg confidence 84, top signal
   `MULTIPLE_IMPERSONATION_INDICATORS 7×`) plus live threat/entity/brand counts and
   the severity mix (MEDIUM 1 / LOW 4), with canonical classification labels in the
   recent-activity tables (fix verified in commit `406faa8`).
7. **Sources page** — dedicated `/sources` page lists all 5 sources (including this
   walkthrough's `globex-e2e-intel` and `initech-e2e-intel`) with the full creation
   form (free-text kind, replacing the old hardcoded `"fixture"`).
8. **Brand detail** — the brand detail page shows live counts (THREATS 1 / OPEN 1 /
   SCANS IN SENTINEL 1), the Module 2 mapping with the derived UUID, brand-scoped
   scans, and threats-against-brand tables.
9. **Network/console hygiene** — no console errors during the walkthrough.

The richer seeded fixture — **NovaPay Support (SYNTHETIC TEST_ONLY)** with four
evidence types — scores **36/100 MEDIUM, PHISHING, 71% confidence** against NovaPay
and is the flagship screenshot: [screenshots/03-threat-detail.png](screenshots/03-threat-detail.png).

### Walkthrough 3 — automatic discovery + related threats (2026-10-10)

Same stack, demo tenant, driven through the console UI against **live public
providers**:

1. **Discover threats** — on the NovaPay brand page, **Discover threats** created
   discovery job `900b4c6d-95ab-4632-8bfb-b873a96c145f`; the job page polled live
   through RUNNING and settled **PARTIAL** with full provider coverage visible:
   `certificate_transparency` **Failed** (945 ms — crt.sh returned HTTP 502,
   upstream outage, error shown verbatim), `certspotter` **Completed** (2
   candidates, 2361 ms — real Certificate Transparency logs), `web_search` **Not
   configured** (no API key — reported, never fabricated). Warning banner:
   *"1 provider(s) unconfigured (web_search); no evidence was fabricated for
   them."* Bounded queries with their Brand-DNA basis are listed per provider
   (`novapay.com` / `novapay.app`, basis `official_domain:…`).
2. **Honest empty state** — the run found 0 unique candidates (CT matches
   suffixes only; both observed names were NovaPay's own official domains) and
   the page says exactly that instead of inventing results. A candidate-rich
   end-to-end run is covered by mocked-provider tests
   (`backend/tests/test_discovery.py`) and documented as such in
   [EVALUATION.md](EVALUATION.md).
3. **Brand navigation** — the job page's **Back to brand** link and Brand field
   resolve the risk-engine UUID back to the Sentinel brand page (uuid bridge);
   verified by clicking through to NovaPay's brand page (fixed in `ca9cbce`).
4. **Related threats** — a threat detail page lists evidence-backed relations by
   exact stored-attribute match with the shared attribute and evidence ids shown;
   when nothing matches, an explicit "No evidence-backed relations" state explains
   that similar-looking names are not counted. With the relation service down, the
   section shows an error instead of guessing (covered by tests).
5. **Live provider pulses** (direct, same day): `https://api.certspotter.com/v1/issuances`
   → HTTP 200; `https://crt.sh/?output=json` → HTTP 502 (outage). The recorded eval
   run in [EVALUATION.md](EVALUATION.md) states the same.
6. **Network/console hygiene** — no console errors during the walkthrough.

## Notes for reproducibility

- On Windows, run `python -m pytest` from PowerShell for the default summary line; in
  some Git Bash terminals the trailing summary can be clipped — the JUnit XML count
  (`--junitxml=<file>`) is authoritative (use a project-relative path; Windows Python
  cannot read `/tmp`).
- Module 2's suite intentionally includes tests that pin the frozen scoring contract;
  the documented floor is **113 passing** — the current run exceeds it at 148 with
  all 113 preserved.
- Databases are disposable: delete a module's `.db` file and re-run its migration/setup
  step to reset state (all fixtures are clearly labelled `SYNTHETIC TEST_ONLY`).
