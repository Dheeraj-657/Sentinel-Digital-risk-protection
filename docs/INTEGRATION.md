# TRUSTGRAPH — integration, debugging & hardening report

Branch `integrate-trustgraph-module4`, built on the original repository commit `6be6936`
(`venkatesh19-prog/TRUSTGRAPH`). One runnable application: four services behind one
console, started with one command.

```
npm run setup   # once
npm run dev     # → http://localhost:5173
```

---

## 1. Merge and baseline

| Step | Result |
|---|---|
| Module 4 ZIP vs. Module 4 branch head (`bb30fa2`) | identical: 0 differing lines |
| `trustgraph-module4.patch` on the original commit `6be6936` | applies cleanly; produces the same tree |
| Conclusion | ZIP, patch and MODULE4.md describe one change set; merged as commit `bb30fa2` without replacing the repository. Modules 1–3 untouched by the merge except the two-line router mount in `backend/app/main.py` |
| Databases, fixtures, generated files | none deleted; no `*.db`, `.env` or `node_modules` tracked |

**Baseline before this pass** (all four services running locally):

| Suite | Baseline |
|---|---|
| Module 2 + 4 backend (pytest) | 169 passed |
| Module 3 (pytest) | 88 passed, 1 skipped |
| Console (vitest) | 103 passed; typecheck + build clean |
| Module 1 | typecheck clean; `test:engine`, `test:brands` passed |

The baseline suites were green, so defects were found by probing the running services
(`curl` against every module, tenant swaps, hostile inputs) and by driving the console
in a headless browser with services stopped one at a time.

---

## 2. Defects found and fixed

Every fix addresses the root cause and has a regression test. Scoring logic was not
changed: all Module 1 demo risk bands and all Module 2 scoring tests pass unchanged.

| # | Module | Defect (as observed) | Root cause | Fix | Regression test |
|---|---|---|---|---|---|
| 1 | M1 | `POST /api/scans` accepted `http://127.0.0.1:8000/readyz`, `169.254.169.254`, `http://[::1]/` (201) | `assertHost` rejected `localhost` but accepted any IP literal | Non-public IP literals rejected in every spelling (`0x7f000001`, `2130706433`, `[::ffff:7f00:1]`, `0.0.0.0`, `*.localhost`, `metadata.google.internal`) → 400 `INVALID_ENTITY` | `engine-check.ts`: 12 rejected + 2 accepted inputs; `e2e-smoke` E2E-2 |
| 2 | M1 | SSRF guard let `::ffff:10.0.0.1`, `::ffff:192.168.1.1`, `::`, NAT64/6to4-embedded private addresses through | `isPrivateIp` only matched a few IPv6 string prefixes | New `net-guard.ts`: full classifier (RFC1918, loopback, link-local/metadata, CGNAT, TEST-NETs, benchmarking, multicast, reserved; IPv6 loopback/unspecified/ULA/link-local/site-local/multicast/documentation/Teredo; IPv4-mapped, IPv4-compatible, NAT64, 6to4 decoded and re-checked); unknown forms count as non-public | `net-guard-check.ts`: 32 blocked + 7 allowed addresses |
| 3 | M1 | DNS-rebinding window: host checked with `dns.lookup`, then `fetch` resolved it again | Check and connect used two separate resolutions | Fetch now goes through `node:http(s)` with a guarded `lookup` hook: the validated answer is the one the socket connects to; any private address in the answer rejects the whole answer; `agent: false` (no reuse) | "production policy refuses a name resolving to 127.0.0.1 (pinned lookup)", "blocks a DNS answer containing any private address" |
| 4 | M1 | Redirects to non-http schemes or credentialed URLs were not rejected | Per-hop check covered the host only | Every hop: http/https only, no `user:pass@`, host/IP re-validated, loop cap → error | Live local-server tests: redirect to metadata IP, to a name resolving to 10.0.0.1, to `file:`, to IPv4-mapped private, loop |
| 5 | M1 | App absent from store data → "Very Low Risk … **No meaningful risk indicators detected**" + "Monitor" | Actions/explanation treated "primary source returned nothing" like "source looked and found nothing" | When the entity type's primary source (app store / crawler / social / WHOIS) has no data and the level is LOW/VERY_LOW: action "Collect missing intelligence before clearing", deterministic caveat "the low score reflects missing evidence, not a clean result", and the grounding guard rejects AI text calling it safe/legitimate. Score unchanged | `engine-check.ts` "missing-intel" (8 checks); E2E-3 |
| 6 | M3 | Evidence `url` accepted `javascript:alert(1)`, `data:`, `file:` | No validation on `EvidenceCreate.url` | Input-only validator: absolute `http(s)://` with a host, ≤ 2048 chars, trimmed (response model untouched so legacy rows stay readable) | `test_non_http_url_rejected` |
| 7 | Console | Module 3 down → workspace blank with "Request failed with status 500 (HTTP_500)" | Vite proxy answers a bare 500 for a dead upstream; page gated everything on the entity load | Proxy returns 502 `SERVICE_UNAVAILABLE` naming the module; workspace keeps verdicts + analyst usable with a banner stating what is missing | "keeps verdicts usable and says so when the evidence store is down", "does not degrade for a genuinely missing entity" |
| 8 | Console | Module 3 down → "**No evidence is stored** for this entity" | Error state collapsed into the empty state | Shows "Evidence could not be loaded … unknown — not the same as having none" | same test (asserts the false sentence is absent) |
| 9 | Console | Relations with engine warnings ("target entity could not be resolved") shown as "No shared identifiers" / tab count 0 | Warnings ignored when `items` was empty | "Relations could not be fully computed" + the engine's warning; tab count `?`; same on the threat page | "treats relations with engine warnings as unknown, not as unconnected" |
| 10 | Console | Module 1 down → brand shown as "**unregistered** … may have been deleted" (workspace, graph) | Lookup miss and registry outage shared one fallback | "registry unavailable" wording whenever the brand list failed to load | graph label test; "never calls a brand 'unregistered' when the registry is unreachable" |
| 11 | Console | Module 2 down → Discovery "Provider status: **No discovery has run yet**" | Error state collapsed into the empty state | "Discovery history could not be loaded … Provider status is unknown" | "reports discovery history as unknown when the risk engine is down" |
| 12 | M4 | A model answer asserting "a confirmed phishing campaign" passed grounding | No rule for campaign claims | Grounding rejects campaign assertions (negations such as "not a confirmed campaign" allowed) → deterministic answer with a note | parametrized grounding test + "negated campaign wording is allowed"; verified against a Groq-compatible stand-in |
| 13 | M4 | Citation chips clipped ("ntity 25c97a02…") on bullet lines | Negative `text-indent` of the bullet inherited by inline-flex chips | `indent-0` on chips | visual check (screenshots 25, 28) |
| 14 | M1 | `next dev` wrote an `AGENTS.md` into `module1/` on every start | Next 16 default | `agentRules: false` in `next.config.ts` | launcher run leaves the tree clean |

Probed and found correct (no change): tenant isolation on every Module 2/3/4 route
(cross-tenant → 404), Module 2 jobs for unknown brand/entity end `FAILED` with
`MISSING_BRAND_DNA` / `INVALID_ENTITY`, Module 2 dependency outages end `FAILED`
`INTEGRATION_UNAVAILABLE` (never a low score), analyst input bounds, the console never
renders untrusted URLs as links, the Python services fetch only operator-configured base
URLs with typed ids (no user-controlled fetch), analyst status never returns the key.

---

## 3. What was added to complete the brief

| Gap in the brief | Added |
|---|---|
| One runnable application, one start command | Root `package.json` + `scripts/trustgraph.mjs` (`setup`, `dev`, `status`, `test`), Windows/macOS/Linux, no dependencies; prefixed logs, health wait, Ctrl+C stops all four (verified: no process left) |
| "AI Security Analyst" as a section; "Compare two reports" | `/analyst` page: ask about any report, compare **any** two reports, summarize a potential campaign |
| "Summarize a potential campaign" | Backend `cluster_threat_ids` + `campaign` intent: members grouped only through stored exact-match relations between them, unlinked members named, always "not a confirmed campaign". Exposed in the workspace analyst, the graph's linked clusters and `/analyst` |
| Discovery Center: analyze a suspicious URL / profile / app | "Analyze a URL, profile or app" box: type auto-detected, runs the Module 1 engine, opens its report |
| Section names | Nav: Overview · Threat graph & campaigns · Investigations · AI Security Analyst · Risk reports · Entities · Brand intelligence · Discovery center · Sources · Scans · History |
| End-to-end verification | `scripts/e2e-smoke.mjs` (`npm run e2e`) |

---

## 4. Per-module summary

**Module 1 — Sentinel DRP (Next.js, :3000).** SSRF hardening (#1–#4) in a dedicated
`net-guard.ts`; missing-primary-intel honesty (#5) across actions, template explanation,
Groq prompt and grounding; `AGENTS.md` generation off (#14).

**Module 2 — Risk engine (FastAPI, :8000).** No scoring change. Verified honest failure
modes for unknown entities/brands and dependency outages.

**Module 3 — Entity & Evidence (FastAPI, :8001).** Evidence URL scheme validation (#6).

**Module 4 — Console + AI Security Analyst.** Campaign intent and grounding rule (#12),
`/analyst` page, quick analyze, cluster summaries, clear upstream-outage errors and
degraded workspace (#7–#11), chip rendering (#13), section names.

---

## 5. Files created, modified, removed

Removed: **none**.

### This integration pass (`bb30fa2..HEAD`)

| File | Change | Why |
|---|---|---|
| `package.json` | added | root scripts: setup / dev / start / status / test / e2e |
| `scripts/trustgraph.mjs` | added | cross-platform launcher |
| `scripts/e2e-smoke.mjs` | added | E2E 1–6 against the live stack |
| `module1/src/lib/engine/net-guard.ts` | added | SSRF classifier, pinned lookup, per-hop validation (#2–#4) |
| `module1/scripts/net-guard-check.ts` | added | SSRF regression checks incl. live redirect server |
| `module1/src/lib/engine/providers/live/live-providers.ts` | modified | live page fetch goes through `guardedRequest` |
| `module1/src/lib/engine/entity.ts` | modified | reject non-public IP literals / internal names at input (#1) |
| `module1/src/lib/engine/actions.ts` | modified | `primaryIntelGaps`; low score + missing primary intel → collect-intel actions (#5) |
| `module1/src/lib/engine/pipeline.ts` | modified | passes primary gaps to actions and explanation |
| `module1/src/lib/ai/fallback.ts`, `prompt.ts`, `grounding.ts` | modified | missing-intel caveat; prompt rule; reject "safe" claims (#5) |
| `module1/scripts/engine-check.ts` | modified | SSRF input cases, missing-intel checks, runs net-guard checks |
| `module1/next.config.ts` | modified | `agentRules: false` (#14) |
| `module3/module3/schemas.py`, `module3/tests/test_api.py` | modified | evidence URL validation + test (#6) |
| `backend/app/module4/schemas.py`, `context.py`, `fallback.py`, `service.py`, `grounding.py` | modified | `cluster_threat_ids`, `campaign` intent, campaign-claim rule (#12) |
| `backend/tests/test_module4_analyst.py` | modified | +8 tests |
| `frontend/src/pages/Analyst.tsx` | added | AI Security Analyst page |
| `frontend/src/lib/scan-input.ts`, `scan-input.test.ts` | added | input type auto-detection |
| `frontend/vite.config.ts` | modified | 502 `SERVICE_UNAVAILABLE` from the dev proxy (#7) |
| `frontend/src/pages/Investigation.tsx` | modified | degraded mode, unknown-vs-none, registry wording, campaign ids (#7–#10) |
| `frontend/src/pages/ThreatGraph.tsx`, `lib/graph.ts` | modified | cluster analyst summary, `clusterThreatIds`, registry wording |
| `frontend/src/pages/DiscoveryCenter.tsx` | modified | quick analyze; unknown provider status (#11) |
| `frontend/src/pages/ThreatDetail.tsx` | modified | relations with warnings shown as unknown (#9) |
| `frontend/src/components/analyst-panel.tsx` | modified | campaign + compare quick actions; exported answer view; chip indent (#13) |
| `frontend/src/components/layout.tsx`, `App.tsx`, `lib/types.ts` | modified | section names, `/analyst` route, request type |
| `frontend/src/pages/module4.test.tsx`, `lib/graph.test.ts` | modified | +23 tests |
| `README.md`, `docs/API.md`, `docs/INTEGRATION.md` | modified / added | one-command start, new contracts, this report |
| `docs/screenshots/24–29-*.png` | added | quick analyze, campaign, compare, cluster summary, analyst page, mobile |

### Module 4 merge (`6be6936..bb30fa2`)

Backend: `backend/app/module4/*` (9 files, new, isolated), `backend/tests/test_module4_analyst.py`,
two lines in `backend/app/main.py`, `backend/.env.example` (commented Groq variables).
Console: new `Investigation`, `Investigations`, `ThreatGraph`, `DiscoveryCenter` pages,
`analyst-panel`, `global-search`, `copy-button`, `lib/graph.ts`, `lib/analyst.ts` + tests;
restyled shell/tokens and existing pages (style and links only). `start-trustgraph.ps1`.
Full list and reasons: [MODULE4.md](MODULE4.md).

---

## 6. APIs and adapters used

| Consumer | API / adapter | Notes |
|---|---|---|
| Console → Module 1 | `GET/POST/PATCH/DELETE /api/brands`, `POST/GET/DELETE /api/scans`, `/api/stats`, `/api/health` | via dev proxy |
| Console → Module 2 | `/api/v1/analysis`, `/api/v1/threats` (+ `/{id}`, `/{id}/status`, `/{id}/related`), `/api/v1/discovery`, `/readyz` | `X-Tenant-ID` |
| Console → Module 3 | `/api/v1/entities` (+ evidence), `/api/v1/sources`, `/healthz` | `X-Tenant-ID` |
| Console → Module 4 | `POST /api/v1/investigation/analyst`, `GET …/analyst/status` | served by Module 2 |
| Module 2 → Module 1 | Sentinel brand adapter (`/api/brands`), cuid → UUID5 bridge | real HTTP adapter when `backend/.env` exists |
| Module 2 → Module 3 | entity / evidence providers + writer | real HTTP adapter |
| Module 2 discovery | crt.sh (CT), Cert Spotter, web search (optional key) | per-provider outcome always reported |
| Module 1 intel | demo providers (`INTEL_MODE=demo`, labelled DEMO); live RDAP + guarded HTTP inspector in `live` mode | |
| AI | Groq OpenAI-compatible API, key only from `module1/.env` / `backend/.env` | deterministic, labelled template fallback without a key |

---

## 7. Test results (this sandbox, final run)

| Suite | Command | Result |
|---|---|---|
| All suites | `npm test` | **7/7 suites passed** |
| Module 2 + 4 backend | `pytest` | **177 passed** (baseline 169) |
| Module 3 | `pytest` | **89 passed, 1 skipped** (baseline 88 + 1) |
| Module 1 typecheck | `npm run typecheck` | clean |
| Module 1 engine + SSRF + missing-intel | `npm run test:engine` | **all 97 checks passed** |
| Module 1 brand input | `npm run test:brands` | all passed |
| Console typecheck | `npm run typecheck` | clean |
| Console | `vitest` | **126 passed** (baseline 103) |
| Console production build | `npm run build` | built |
| End-to-end | `npm run e2e` | **20/20 checks passed** |

### End-to-end tests 1–7

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Fake profile | ✔ | M1 scan `instagram:novapay.support.help` → HIGH 75; registered SOCIAL_PROFILE + 3 evidence → M2 verdict MEDIUM 26 |
| 2 | Suspicious website | ✔ | M1 `n0vapay-secure-login.com/verify` → look-alike signal, LOW 30 **flagged unverified** (demo mode has no crawl/WHOIS data for it) with "Collect missing intelligence"; M2 verdict for registered site; 3 SSRF targets refused (400) |
| 3 | Suspicious app | ✔ | M1 clone app → CRITICAL 84; app without store data → not cleared; M2 verdict for registered app |
| 4 | Threat graph | ✔ | profile ↔ app linked by exact shared domain (`EXACT_ATTRIBUTE_MATCH`); unrelated website not linked; cross-tenant 404; browser: cluster + analyst summary render |
| 5 | AI analyst | ✔ | why (score + 3 evidence cited), compare, campaign (linked members only, unlinked named, "not a confirmed campaign"), cross-tenant 404, status hides key. Groq path vs. stand-in: grounded answer accepted (`GROQ`, model shown); invented number and "confirmed campaign" rejected → template with note |
| 6 | Unified workflow | ✔ | one origin reaches all services; discovery runs and reports `FAILED` honestly (CT providers unreachable from the sandbox, web search unconfigured); browser: Discovery quick analyze → scan report → workspace campaign + compare → graph cluster summary, 0 page errors |
| 7 | Failure handling | ✔ | each of Modules 1, 2, 3 stopped in turn; 9 pages × 3 outages: **no page crashed**, every page names the missing service; jobs end `FAILED INTEGRATION_UNAVAILABLE`; analyst answers from what remains and lists what was unavailable |

Mobile (390 px): `/analyst`, `/discovery`, `/graph`, `/investigate` — 0 px horizontal overflow.

---

## 8. Problem-statement coverage

| Required | Status | Where |
|---|---|---|
| Overview | ✔ | `/` posture, classification mix, jobs, scans, discovery, sources |
| Brand Intelligence | ✔ | `/brands`, `/brands/:id` (brand DNA, official assets, threats against the brand, brand-scoped scans) |
| Discovery Center | ✔ | `/discovery` quick analyze + brand discovery + provider status + discovered vs. manual entities |
| Risk Reports | ✔ | `/threats` (risk-engine verdicts), `/threats/:id`, `/scans` (Sentinel reports), `/analysis/history` |
| Threat Graph & Campaigns | ✔ (campaigns as candidate groupings) | `/graph` exact-match edges, linked clusters, cluster analyst summary |
| AI Security Analyst incl. campaign summary and comparing two reports | ✔ | `/analyst`, docked in every investigation, graph clusters |
| Unified Investigation Workspace | ✔ | `/investigate/:entityId` overview / evidence / risk / connections / history + analyst |
| Every control has a real action | ✔ | each control calls an existing API or navigates; covered by component tests and the browser walkthrough |
| Tenant isolation | ✔ | cross-tenant 404 on Modules 2/3/4 (tests + E2E) |
| SSRF protection incl. redirects | ✔ | #1–#4 |
| No secrets exposed | ✔ | keys only in gitignored `.env`; status endpoints report `configured` only; ZIP built with `git archive` |
| Mock data labelled | ✔ | DEMO / SYNTHETIC TEST_ONLY / E2E SYNTHETIC labels; template answers labelled |
| Missing intel never shown as safe | ✔ | #5, #8–#11 |
| Campaign detection | ◐ by design | no model invents groupings; exact shared identifiers only, stated in every answer |

---

## 9. Remaining limitations

- **Demo intel mode.** Module 1 ships `INTEL_MODE=demo`; unknown targets get no crawl,
  WHOIS or feed data and are therefore reported as unverified rather than scored high.
  `live` mode uses free RDAP + the guarded HTTP inspector.
- **Combo-squats in Module 2.** Whole-domain character n-gram similarity keeps
  `brand-secure-xyz.example` below the 0.4 threshold; scoring deliberately unchanged.
- **No authentication.** `X-Tenant-ID` is trusted as sent; run behind an authenticating
  gateway beyond localhost.
- **Groq not reachable from the build sandbox.** The analyst's Groq path was verified
  against an OpenAI-compatible stand-in; with a real key the same code path is used.
- **Discovery providers.** crt.sh / Cert Spotter were unreachable from the sandbox; outcomes
  are reported per provider and nothing is invented.
- **Single-node SQLite, in-process workers**, dev servers (Vite proxy) for the unified origin.
  For production, serve `frontend/dist` behind a reverse proxy with the same path routing.
- **Pushing to GitHub** (`Dheeraj-657`) was not possible from this environment: no GitHub
  account is linked to the session. The ZIP and patch carry the full history-free tree.
