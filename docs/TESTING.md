# TRUSTGRAPH — Test & Build Report

All results below were captured on **2026-10-09/10 (Windows 10, Node 24.18, Python
3.13)** by re-running every command immediately before submission. Commands are
PowerShell, run from the module's directory.

## Summary

| # | Suite | Command | Result |
|---|---|---|---|
| 1 | Frontend types | `npm run typecheck` | **clean** (TypeScript 5.9, strict) |
| 2 | Frontend unit tests | `npm run test` | **29/29 passed** |
| 3 | Frontend production build | `npm run build` | **✓ built in ~1.7 s** |
| 4 | Module 2 risk engine | `python -m pytest` | **113/113 passed** (0 failures, 0 errors, 0 skipped) |
| 5 | Module 3 evidence store | `python -m pytest` | **71/71 passed** (0 failures, 0 errors, 0 skipped) |
| 6 | Module 1 types | `npm run typecheck` | **clean** |
| 7 | Module 1 engine self-check | `npm run test:engine` | **all engine checks passed** |

## Commands and captured output

### Frontend (`cd frontend`)

```powershell
npm run typecheck   # tsc --noEmit → no output, exit 0
npm run test        # vitest run
npm run build       # tsc --noEmit && vite build
```

```
 ✓ src/lib/format.test.ts (9 tests)
 ✓ src/lib/api.test.ts (12 tests)
 ✓ src/lib/brand-bridge.test.ts (8 tests)

 Test Files  3 passed (3)
      Tests  29 passed (29)
```

Build output: `dist/assets/index-*.js 340.48 kB │ gzip: 102.85 kB — ✓ built in 1.66s`
(25 kB CSS, self-hosted variable fonts; no runtime errors in the browser console
during the E2E walkthrough — only Vite HMR and React DevTools notices).

### Module 2 — risk engine (`cd backend`, venv active)

```powershell
python -m pytest
```

113 dots, then `113 passed` — verified via JUnit XML for an authoritative count:

```
M2 tests=113 failures=0 errors=0 skipped=0
```

Covers: schema validation, scoring math (weights, levels, confidence), job lifecycle
(queued/running/completed/failed/cancelled), idempotency keys, tenant isolation,
Module 1/3 HTTP adapters (real FastAPI test doubles over the actual wire contract),
threat register/status transitions, and API error semantics. pytest emits dependency
deprecation **warnings** (no failures); counts above exclude none.

### Module 3 — entity & evidence (`cd module3`, venv active)

```powershell
python -m pytest
```

```
M3 tests=71 failures=0 errors=0 skipped=0
```

Covers: normalization on ingest, required-field validation, source-provenance
enforcement, tenant scoping (cross-tenant = 404), pagination, and
`test_contract_parity.py` — which validates this service's actual HTTP JSON against
Module 2's pydantic `EntityReference`/`EvidenceReference` schemas so the wire
contract cannot drift.

### Module 1 — Sentinel DRP (`cd module1`)

```powershell
npm run typecheck   # tsc --noEmit → clean
npm run test:engine
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

Executed 2026-10-09 against the full stack (M1 :3000, M2 :8000, M3 :8001, console
:5173), demo tenant `11111111-…-5555`:

1. **Health** — all three modules reported healthy through the console's dev proxy
   (`/api/health`, `/readyz`, `/healthz`); Overview page rendered live module
   status including honest disclosure ("intel: demo · AI: template only").
2. **Register entity** — `ShopVerse Prize Portal (SYNTHETIC TEST_ONLY)`
   (`9a518a63-c89f-4ca5-83ec-4a9d9a0b5eca`, domain `shopverse-prize-portal.example`,
   handle `shopverse_prizes`) via the UI form → 201 from Module 3.
3. **Create source + attach evidence** — source `synthetic-console-e2e (SYNTHETIC
   TEST_ONLY)`; `TEXT_CONTENT` (`80731f6b-…`, prize-scam text) and `DOMAIN_INTEL`
   (`70cfcd92-…`, `https://shopverse-prize-portal.example/claim`) via the UI form.
   Verified the evidence timeline and source counts update correctly (including the
   fix where an inline-created source previously showed as "unknown source").
4. **Run analysis** — ShopVerse (derived UUID `f453f161-…`) vs the entity; job
   `647e1966-4fc8-405d-b9f0-b1299b7d4e81` → `COMPLETED` in ~5 s with result
   (score **15/100 LOW**, Unclassified, confidence 46%).
5. **Threat detail** — threat `3c4011c5-…`: factor rows with points/weights/
   confidence/basis, evidence provenance resolved from Module 3 with real ids,
   generated explanation, synthetic-data disclosure, suggested next steps.
6. **Register propagation** — Overview and Threat register both list the new threat
   (severity mix updated: MEDIUM 1 / LOW 1); filters/sort/search exercised.
7. **Network/console hygiene** — all browser requests returned 200/304; console
   showed no errors.

A second, richer fixture — **NovaPay Support (SYNTHETIC TEST_ONLY)** with four
evidence types — scores **36/100 MEDIUM, PHISHING, 71% confidence** against NovaPay
and is the flagship screenshot: [screenshots/03-threat-detail.png](screenshots/03-threat-detail.png).

## Notes for reproducibility

- On Windows, run `python -m pytest` from PowerShell for the default summary line; in
  some Git Bash terminals the trailing summary can be clipped — the JUnit XML count
  (`--junitxml=<file>`) is authoritative (use a project-relative path; Windows Python
  cannot read `/tmp`).
- Module 2's suite intentionally includes tests that pin the frozen scoring contract;
  the documented floor is **113 passing** — the current run meets it exactly.
- Databases are disposable: delete a module's `.db` file and re-run its migration/setup
  step to reset state (all fixtures are clearly labelled `SYNTHETIC TEST_ONLY`).
