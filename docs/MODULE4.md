# Module 4 — Dashboard & AI Security Analyst

**Scope:** complete Module 4 inside the existing combined console (`frontend/`), connected to the existing Module 1–3 services. Modules 1–3 are preserved; no business logic, schema, migration, enum, ID or event contract was changed.

Date: 2026-10-10. All results below come from commands actually run against this repository and the four services running locally (with copies of the local SQLite databases).

---

## 1. What Module 4 adds

| Area | Route | What it does | Data source (existing API) |
|---|---|---|---|
| Overview dashboard | `/` | Threat posture by level (critical first), classification mix, protected brands, entities, threats, open/confirmed, scans, latest analysis jobs with a 14-day activity chart, Sentinel high-risk scans and top signals, discovery runs, data-source status and an honest campaign-detection note. Every number links to the filtered register or record. | M2 `GET /threats`, `GET /analysis`, `GET /discovery`; M3 `GET /entities`; M1 `GET /brands`, `/stats`, `/health` |
| Investigations index | `/investigate` | Every entity ranked by its highest verdict; filters by type, text and "with verdict / not analysed". | M3 `GET /entities`; M2 `GET /threats` |
| **Unified investigation workspace** | `/investigate/:entityId` | One canonical view per entity: identifiers (copyable), verdict selector across brands, **Overview** (calculated risk, protected-brand reference with exact official-asset comparison, evidence and discovery metadata, recommended actions), **Evidence** (expandable, provenance, "used in" factors, URLs as text), **Risk breakdown** (factor bars, basis, evidence chips, families with no signal), **Connections** (exact-match relations), **History** (analysis runs, verdicts per brand, matching Sentinel scans). The **AI Security Analyst** is docked beside it. | M3 entity/evidence/sources; M2 threats, threat detail, related, jobs; M1 brands, scans; M4 analyst |
| AI Security Analyst | inside the workspace | Chat with suggested questions, conversation history, compare-with selector, loading/error/retry, inline citation chips (evidence → focuses the evidence card; threat/entity → opens the record), and a "what this answer used" disclosure (evidence available vs cited, verdicts, relations, brand reference, missing data). Labels each answer **AI assessment** (Groq) or **Evidence summary (template)**. | **New** M4 `POST /api/v1/investigation/analyst` |
| Threat graph | `/graph` | Entities, protected brands and shared-identifier hubs. Zoom (wheel/buttons), pan (drag), fit, focus (`?focus=`), filters (edge type, brands, minimum risk, entity type), node and edge detail panel, keyboard-focusable nodes, **table alternative** (`?view=table`), and **Linked clusters**. | M2 `GET /threats`, `GET /threats/{id}/related` (fan-out, 4 concurrent, ≤100 verdicts); M3; M1 |
| Discovery center | `/discovery` | Start discovery for a brand (existing job), per-provider status of the latest run, all runs with status filter, and every entity with its collection source (discovery run or manual), type, registration time and verdict. | M2 `POST/GET /discovery`; M3 `GET /entities` |
| Global search | top bar (`/` to focus) | Entities (by name, id, any identifier), threats and brands; arrow keys + Enter; reports which services could not be searched. | Same list endpoints, loaded lazily on first focus |
| Design system | all pages | Charcoal foundation, one orange accent for controls, translucent glass surfaces, a risk scale distinct from the accent, sentence-case labels, grouped navigation, skip link, focus rings, reduced-motion support. Applied through the existing tokens, so every existing page shares it. | — |

The four report concepts are kept visually distinct everywhere: **Collected evidence** (steel), **Calculated risk** (risk scale), **AI assessment** (violet), **Recommended actions** (blue).

## 2. Backend change (isolated, additive)

Module 2 had no operation that answers analyst questions. One isolated package was added, `backend/app/module4/`:

| File | Role |
|---|---|
| `router.py` | `POST /api/v1/investigation/analyst`, `GET /api/v1/investigation/analyst/status` (configuration only, never the key) |
| `context.py` | Assembles grounded context **read-only** from existing services: the threat register (`ThreatService`), `RelatedThreatService` (unchanged; wrapped in a per-request memoizing proxy so repeated entity lookups hit Module 3 once), the Module 3 entity/evidence adapters, and the Module 1 brand client. Records gaps in `missing`. |
| `llm.py` | Groq (OpenAI-compatible) client: JSON mode, temperature 0.2, retries honouring `retry-after`, concurrency cap 3. |
| `grounding.py` | Ports Module 1's grounding policy: inline citations `[ev:…]`/`[threat:…]`/`[entity:…]` must exist in the context (unknown ones are stripped and reported); numbers not in the context reject the answer; a risk level or score that differs from stored verdicts rejects it; claims that a block/report/takedown was performed reject it; an answer that cites none of the available evidence is rejected. |
| `fallback.py` | Deterministic answers composed only from stored records (why / evidence / relations / next steps / compare / summary). Used when no key is set, the provider fails, or grounding rejects the model output; the response says which and why. |
| `settings.py` | Reads `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_BASE_URL` — the same names Module 1 uses. |

**Only change to existing Module 2 code:** two lines in `backend/app/main.py` (import + `include_router`). Tenant isolation reuses Module 2's `get_tenant` dependency; cross-tenant threats return the same 404 as Module 2. The analyst never scores, writes threats, collects evidence or performs external actions. Evidence text is passed to the model explicitly marked as untrusted data.

## 3. Files

**New:** `backend/app/module4/*` (7 files), `backend/tests/test_module4_analyst.py`, `frontend/src/pages/{Investigation,Investigations,ThreatGraph,DiscoveryCenter}.tsx`, `frontend/src/components/{analyst-panel,global-search,copy-button}.tsx`, `frontend/src/lib/{graph,analyst}.ts` (+ tests), `frontend/src/pages/module4.test.tsx`, `start-trustgraph.ps1`, this document, screenshots 15–23.

**Modified (Module 4 / console only):** `App.tsx` (routes), `components/layout.tsx` (shell), `components/ui.tsx` (styling), `index.css` (design tokens), `lib/api.ts` + `lib/types.ts` (additive `m4` client and types), `pages/Dashboard.tsx` (rebuilt overview), `components/threat-table.tsx` and `pages/{ThreatDetail,EntityDetail}.tsx` (links into the workspace; `recommendedSteps`/`scoreLevel` exported for reuse), `test/api-mock.ts` (m4 mock), and a style-only sweep removing all-caps label classes from the other console pages. `backend/.env.example` documents the analyst variables (comments only).

**Untouched:** everything in `module1/`, `module3/`, and every Module 2 file other than the two lines in `main.py`.

## 4. Test and build results (executed)

| Suite | Command | Before Module 4 | After |
|---|---|---|---|
| Module 2 (risk engine + analyst) | `cd backend && python -m pytest` | 148 passed | **169 passed** (148 + 21 analyst tests) |
| Module 3 | `cd module3 && python -m pytest` | 88 passed, 1 skipped | **88 passed, 1 skipped** (unchanged) |
| Frontend unit/page tests | `cd frontend && npm run test` | 83 passed | **103 passed** (83 + 20) |
| Frontend types | `npm run typecheck` | clean | **clean** |
| Frontend build | `npm run build` | ✓ | **✓** |
| Module 1 | `npm run typecheck`, `test:engine`, `test:brands` | pass | **pass** (unchanged) |
| Health | `/api/health` (M1), `/healthz` (M3), `/readyz` (M2), `/api/v1/investigation/analyst/status` | — | all **200** |

No pre-existing test was modified except adding the `m4` entry to the shared API mock.

Browser verification (headless Chromium, real services): every console page at 1366×768 and at 390×844 with no horizontal page scroll and no console errors; analyst question → answer → evidence-citation focus; compare flow; global search with keyboard; brand → threat → workspace → connections → analyst journey.

## 5. Problem-statement workflows

| # | Workflow | Result | Notes |
|---|---|---|---|
| 1 | Fake social profile | **Works with existing functionality + Module 4 workspace** | Brand → entity (SOCIAL_PROFILE) → identity/behavioral evidence → verdict and factors. Profile metadata is whatever evidence was collected; there is no live social-platform API in Modules 2/3. |
| 2 | Suspicious website/domain | **Works** for stored domain intel (registration age, WHOIS privacy, URL) and lexical/brand signals. | Redirect and CAPTCHA observations exist only in Module 1 Sentinel scans (demo or live mode); the workspace's History tab links matching Sentinel scans. Module 2/3 have no redirect collector. |
| 3 | Suspicious mobile app | **Partially.** MOBILE_APP entities, identifiers (package, domain), brand comparison and exact-match links work. | Developer name, permissions and store metadata come only from Module 1 Sentinel scans, which use the **demo dataset** (labelled). No live app-store provider exists. |
| 4 | Connected threats | **Works after the Module 4 graph/workspace.** | Verified with two SYNTHETIC entities (profile + app) sharing a domain: exact-match edge, cluster, evidence links, analyst relation answer. Campaign detection is **not implemented** in the backend; clusters are labelled as leads. |
| 5 | Explainable AI assessment | **Works after the Module 4 analyst endpoint.** | Template path verified live against real data. Groq path verified end to end through a local OpenAI-compatible stand-in (api.groq.com is not reachable from the build sandbox): grounded answer accepted and labelled; an answer inventing "4,812 customers" rejected and replaced, with the reason shown. **Live Groq was not exercised** — set `GROQ_API_KEY` in `backend/.env` to use it. |
| 6 | End-to-end investigation | **Works.** | Browser walkthrough: `/brands/NovaPay` → threat row → workspace → Connections → analyst answer about the linked entity, keeping entity, verdict and brand context. |
| 7 | Honest data availability | **Works.** | Overview "Data sources", Sentinel intel mode, "Template mode" badge, SYNTHETIC labels, provider status per discovery run, explicit "no verdict yet", "relations could not be loaded", and "absence of a signal is not evidence of legitimacy". |

## 6. Real, mock and unavailable

| Capability | Status |
|---|---|
| Risk scores, factors, confidence, classification | **Real** (Module 2 engine) |
| Entities, evidence, sources | **Real** records (Module 3); demo records are named `SYNTHETIC TEST_ONLY` |
| Brand DNA | **Real** (Module 1 registry) |
| Exact-match relations | **Real** (Module 2 `/related`) |
| Discovery | **Real** providers (CT logs); web search needs a key; recorded runs were PARTIAL/FAILED with 0 candidates, shown as such |
| Sentinel scans | **Real** engine; reputation/social/app intel is **demo dataset** unless `INTEL_MODE=live` (still partial) |
| AI analyst text | **Groq when `GROQ_API_KEY` is set** in `backend/.env`; otherwise **deterministic template** (labelled) |
| Campaign detection | **Not implemented in the backend** — UI shows exact-match clusters, labelled as leads |
| Report export | Not added (no backend export operation); Module 1 scan pages keep their existing JSON export |

## 7. Known limitations

- The graph fans out one `/related` call per verdict (≤100, 4 concurrent). `RelatedThreatService` is O(n) entity lookups per call, so very large tenants would benefit from a server-side graph endpoint; none was added to avoid duplicating relationship logic.
- Lists read the first 200 records (existing API limits); pages state when results are truncated.
- Module 3 deduplicates entities by domain within an entity type, so shared-domain links appear between different entity types (e.g. a profile and an app), or via shared handles.
- The console has no authentication (pre-existing); tenancy is the `X-Tenant-ID` header, enforced by Modules 2/3.
