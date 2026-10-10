# TRUSTGRAPH — test access & evaluation notes

For reviewers of the integrated build (branch `integrate-trustgraph-module4`). Everything
runs locally; there are no hosted URLs, accounts or passwords.

## 1. Access

| What | Value |
|---|---|
| Start | `npm run setup` (once), then `npm run dev` from the repo root |
| Console (use this) | http://localhost:5173 |
| Module 1 · Sentinel DRP (own UI + API) | http://localhost:3000 — health `/api/health` |
| Module 2 · Risk engine + AI analyst API | http://localhost:8000 — health `/readyz`, interactive API docs `/docs` |
| Module 3 · Entity & evidence API | http://localhost:8001 — health `/healthz`, API docs `/docs` |
| Login | none (local evaluation build) |
| Tenant | `11111111-2222-3333-4444-555555555555` (demo, preset in the console; switch under **Settings**). Direct API calls need header `X-Tenant-ID: <tenant>` on Modules 2/3/4 |
| AI key (optional) | `GROQ_API_KEY=` in `module1/.env` and `backend/.env`, restart. Without it answers are deterministic and labelled "template" — every feature still works |
| Check everything is up | `npm run status` (also the sidebar: Risk engine / Evidence store / Brand service) |

Requirements: Node 20+, Python 3.11+. Windows: no `& % ^ !` in the folder path.

## 2. Demo data

| Data | Where it comes from |
|---|---|
| Protected brands **NovaPay** (novapay.com, novapay.app, @novapay, com.novapay) and **ShopVerse** (shopverse.com) | Module 1 seed, labelled demo |
| Sample Sentinel scans | Module 1 seed |
| Entity **Acme Corp Support** (acme-support.com) + 4 evidence items | Module 3 seed, labelled `SYNTHETIC TEST_ONLY` |
| Entities from `npm run e2e` | created by the smoke test, labelled `E2E SYNTHETIC` |

Module 1 runs in `INTEL_MODE=demo`: WHOIS, page crawl, threat feeds and app-store data come
from a labelled demo dataset. Targets outside that dataset get no such data and are reported
as **unverified**, never as safe.

### Inputs with known outcomes (Discovery center → "Analyze a URL, profile or app", or Scans → New)

| Scenario | Type | Input | Brand | Expected |
|---|---|---|---|---|
| Credential-phishing page | Website | `https://secure-novapay.verify-account.top/login` | NovaPay | Critical |
| Homoglyph support domain | Domain | `n0vapay-support.com` | NovaPay | Critical |
| Fake support account | Profile | `https://instagram.com/novapay.support.help` | NovaPay | High–Critical |
| Crypto airdrop scam | Profile | `telegram:novapay_airdrop` | NovaPay | Critical |
| Malicious clone app | App | `com.novapay.wallet.secure` | NovaPay | High–Critical |
| Reward scam on free hosting | Website | `https://novapay-rewards.netlify.app/claim` | NovaPay | Medium–High |
| Giveaway page | Profile | `facebook:shopverse.giveaways` | ShopVerse | Medium–High |
| Look-alike outlet store | Domain | `shopverse-outlet-sale.shop` | ShopVerse | Medium–High |
| Official domain (control) | Domain | `novapay.com` | NovaPay | Very low, "verified official asset" |
| Official X account (control) | Profile | `x:novapay` | NovaPay | Very low |
| Official app (control) | App | `com.novapay.wallet` | NovaPay | Very low |
| Unknown, no brand | Domain | `parcel-redelivery-fee.info` | — | Very low–Medium |
| Missing intel (honesty check) | App | `com.novapay.rewards.test1` | NovaPay | Low score **with** "Collect missing intelligence before clearing" — not cleared |
| Blocked internal target (security check) | Website | `http://169.254.169.254/` or `http://127.0.0.1:8000/` | — | Refused: "Private, loopback and link-local addresses can't be analysed." |

## 3. Evaluation walkthrough (≈10 minutes)

1. **Overview** (`/`) — posture by risk level, classification mix, jobs, scans, discovery, data sources. Click any number → filtered list.
2. **Brand intelligence** (`/brands`) — open NovaPay: brand DNA, official assets, threats against it, brand-scoped scans.
3. **Discovery center** (`/discovery`) — paste an input from §2 into *Analyze a URL, profile or app* (type is auto-detected) → report opens. *Start discovery* for NovaPay → per-provider outcome (without internet access providers show FAILED/UNCONFIGURED; nothing is invented).
4. **Risk reports** (`/threats`, `/scans`) — risk-engine verdicts and Sentinel reports; open one for factors, evidence, recommended actions.
5. **New threat analysis** (top right) — pick a brand and an entity (e.g. Acme Corp Support, or any E2E entity) → job → verdict.
6. **Investigation workspace** (`/investigate` → an entity) — tabs Overview / Evidence / Risk breakdown / Connections / History with the AI Security Analyst docked. Try *Why was this entity classified…*, *Summarize a potential campaign involving this entity*, *Compare these two reports*. Click an `ev …` citation → jumps to that evidence.
7. **Threat graph & campaigns** (`/graph`) — zoom/pan/fit, filters, Table view; select an edge to see the shared value; *Summarize potential campaign* on a linked cluster.
8. **AI Security Analyst** (`/analyst`) — Ask about a report · Compare any two reports · Summarize a potential campaign (members pre-selected only from exact shared identifiers).
9. **Failure handling** — stop one service (Ctrl+C its terminal if started manually, or kill its process) and reload pages: the sidebar shows it *down*, pages name the unreachable module, nothing crashes, and missing data is shown as unknown — not as "none" or "safe".

Quickest full check of steps 1–8 from the command line: `npm run e2e` (20 checks, while `npm run dev` is running).

## 4. Evaluation notes — what to expect and why

- **Scores are deterministic.** Module 1 and Module 2 compute risk without AI; the AI layer only explains and is checked against the evidence (invented numbers, wrong levels, unknown citations, claimed actions, "safe" claims on missing intel and "confirmed campaign" claims are rejected and replaced by the labelled template).
- **Two engines, two scales.** Sentinel scans (Module 1) score a raw URL/profile/app from collected intel; risk-engine verdicts (Module 2) score a registered entity from its stored evidence against brand DNA. The same subject can therefore get different numbers on each — both are shown, neither is recalculated in the console.
- **Relations and campaigns.** Links exist only where two entities store the identical domain/handle/package (`EXACT_ATTRIBUTE_MATCH`). Clusters and campaign summaries are candidate groupings for review; there is no campaign-detection model and the UI says so.
- **Missing ≠ safe.** No data, a failed provider or a down service is shown as unknown/unverified everywhere.
- **Security.** Tenant isolation on every Module 2/3/4 route (other tenant → 404); internal/private addresses refused on input and on every redirect hop; evidence URLs must be http(s); API keys only in gitignored `.env` files; analyst status reports *configured* yes/no, never the key.
- **Known limitations.** Demo intel mode in Module 1; Module 2 does not score combo-squat domains (`brand-secure-xyz.example`) as look-alikes; no login (header-based tenant); discovery providers need internet access; SQLite + in-process workers (local scale).

## 5. Recorded results (2026-10-10, this build)

| Check | Result |
|---|---|
| `npm test` — all suites | 7/7 passed: backend 177, Module 3 89 (+1 skipped), console 126, Module 1 typecheck + 97 engine/SSRF/missing-intel checks + brand checks |
| Console production build | passed |
| `npm run e2e` (E2E 1–6) | 20/20 |
| E2E 7 failure handling | Modules 1, 2, 3 stopped in turn × 9 pages: no crash, outage named on every page |
| Clean install from the ZIP | `npm run setup` + `npm test` passed |
| Mobile (390 px) | no horizontal overflow on analyst, discovery, graph, investigations |

Full defect list, file changes and coverage: [INTEGRATION.md](INTEGRATION.md).
