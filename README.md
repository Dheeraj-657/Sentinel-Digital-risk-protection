# TRUSTGRAPH — Brand-Impersonation Threat Intelligence Platform

TRUSTGRAPH answers one question for any discovered digital entity (website, social
profile, domain, mobile app, messaging account):

> **How suspicious is this entity, and why?**

Operators pick a protected brand, point the deterministic risk engine at a discovered
entity, and get back a **0–100 risk score**, a **risk level**, a **classification**, a
**confidence score**, and a transparent **breakdown into seven evidence-backed factor
families** — with every evidence item traceable to its source (provenance), and a clear
distinction between what was **observed** and what the engine **inferred**.

TRUSTGRAPH is a four-service integration of three independently developed modules plus
a unified analyst console:

| Service | Port | Stack | Role |
|---|---|---|---|
| **Module 1 — Sentinel DRP** (`module1/`) | 3000 | Next.js 16, Prisma, SQLite | Protected-brand registry (**Brand DNA**: official domains, handles, app developers, package prefixes, keywords) + a standalone scan experience with Groq AI assessments |
| **Module 2 — Risk Engine** (`backend/`) | 8000 | Python 3.11, FastAPI, SQLAlchemy, Alembic | Canonical scoring service: async analysis jobs, weighted factor scoring, confidence, classification, threat register |
| **Module 3 — Entity & Evidence** (`module3/`) | 8001 | Python 3.11, FastAPI, SQLAlchemy, Alembic | Entity register, evidence items with source provenance, tenant-scoped |
| **Frontend console** (`frontend/`) | 5173 | Vite, React 19, TypeScript (strict), Tailwind v4 | Unified analyst console across all three modules |

---

## Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │  Browser — TRUSTGRAPH console (Vite, :5173)  │
                        │  X-Tenant-ID header on every API call       │
                        └───────────────┬─────────────────────────────┘
                                        │ dev proxy (vite.config.ts)
        ┌───────────────────────────────┼───────────────────────────────┐
        │ /api/brands, /api/health      │ /api/v1/*, /readyz            │ /api/v1/entities,
        ▼                               ▼                               │ /api/v1/sources, /healthz
┌───────────────────┐          ┌───────────────────┐          ┌───────────────────┐
│ Module 1 :3000    │          │ Module 2 :8000    │          │ Module 3 :8001    │
│ Sentinel DRP      │◀─────────│ Risk engine       │─────────▶│ Entity & Evidence │
│ Brand DNA         │  GET     │ (canonical,       │  GET     │ entities, evidence │
│ brands, scans     │  brands  │  frozen contract) │  entity+ │ sources, tenants  │
└────────┬──────────┘          └────────┬──────────┘  evidence└────────┬──────────┘
         │                              │                     ▲         │
   Prisma + SQLite               SQLAlchemy + SQLite           └─────────┘
   (prisma/dev.db)               (trustgraph_module2.db)         (module3.db)
```

**Request flow for one analysis run**

1. The console lists brands from **Module 1** and entities from **Module 3**.
   Module 1 brand ids are cuids; the console derives the risk-engine's stable UUID via
   `uuidv5` (`frontend/src/lib/brand-bridge.ts`) so Module 2 can reference brands
   without a runtime dependency on Module 1.
2. `POST /api/v1/analysis {brand_id, entity_id}` (Module 2) creates an **asynchronous
   job** (202 + `Idempotency-Key` supported). The console lands on a live job page and
   polls until the job completes, fails, or is cancelled.
3. The engine worker fetches the entity and its evidence **live from Module 3** over
   HTTP (never from fixtures inside Module 2), fetches Brand DNA from Module 1, runs
   the seven factor scorers, and produces a scored **threat** record.
4. The threat register / detail pages read the verdict back from Module 2; every factor
   row shows its evidence ids, which the console resolves to provenance (source name,
   collection time) via Module 3.

**Tenancy.** Every Module 2/3 request carries `X-Tenant-ID`; data is tenant-scoped and
missing vs cross-tenant lookups are indistinguishable (404). The console pins a demo
tenant (`11111111-2222-3333-4444-555555555555`, switchable in the UI).

## Repository layout

```
ff90d917/
├── module1/          Sentinel DRP (Module 1) — Next.js app
├── backend/           Risk engine (Module 2) — FastAPI app + Alembic + tests
├── module3/           Entity & evidence (Module 3) — FastAPI app + Alembic + tests
├── frontend/          TRUSTGRAPH console — Vite + React + TypeScript + Vitest
├── docs/
│   ├── API.md         API reference for all three modules + risk-scoring output
│   ├── TESTING.md     Test/build report: exact commands and results
│   ├── screenshots/    Captured UI walkthrough (14 pages)
│   └── modules/module-2/  Module 2's full engineering doc set (15 files)
└── README.md
```

## Prerequisites

| Tool | Version used | Needed for |
|---|---|---|
| Node.js + npm | Node 24.18 / npm 11 | Module 1, frontend |
| Python | 3.11+ (3.13 used) | Module 2, Module 3 |
| Git Bash or PowerShell | Windows 10/11 | startup commands below |

No other services are required — each module uses its own SQLite database. Internet
access is needed once for `npm install` / `pip install`.

---

## Quick start (Windows PowerShell)

Run each block in a **separate PowerShell window**. Startup order matters only for
Modules 2/3 needing to be up before you run an analysis; health checks are included.

### 0. One-time per module (first run)

```powershell
# --- Module 1: Sentinel DRP --------------------------------------------
cd module1
npm install
npm run setup        # prisma generate + db push + seed (NovaPay, ShopVerse + sample scans)

# --- Module 3: Entity & Evidence ---------------------------------------
cd module3
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -e ".[dev]"
Copy-Item .env.example .env         # defaults are fine
alembic upgrade head                # creates module3.db
# Optional synthetic fixtures (Acme Corp Support entity + 4 evidence items):
python -m module3.seed 11111111-2222-3333-4444-555555555555

# --- Module 2: Risk engine ----------------------------------------------
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env         # IMPORTANT: enables the real Module 1/3 HTTP adapters
alembic upgrade head                # creates trustgraph_module2.db

# --- Frontend console ---------------------------------------------------
cd frontend
npm install
```

> **Do not skip `Copy-Item .env.example .env` in `backend/`.** Without it, Module 2
> falls back to its built-in MOCK adapters for Modules 1/3 and you will not see the
> real cross-service integration. `backend/.env` is gitignored and already exists on
> the development machine.

### 1. Start Module 1 — Sentinel DRP (port 3000)

```powershell
cd module1
npm run dev
# ready when the terminal prints the local URL; verify:
#   curl http://localhost:3000/api/health
```

### 2. Start Module 3 — Entity & Evidence (port 8001)

```powershell
cd module3
.\.venv\Scripts\Activate.ps1
uvicorn module3.main:app --port 8001
# verify: curl http://localhost:8001/healthz
```

### 3. Start Module 2 — Risk engine (port 8000)

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --port 8000
# verify: curl http://localhost:8000/readyz   → {"status":"ready",...}
```

### 4. Start the console (port 5173)

```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173**. The Overview page shows live health for all three
modules ("Sources of truth"). Module 1 also has its own standalone UI at
http://localhost:3000 (scan experience with AI assessment).

---

## Environment variables

All optional beyond the defaults shown; **none of the API keys below are committed**.

**Module 1** (`module1/.env`, see `module1/.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `GROQ_API_KEY` | — | Groq key for AI text assessments. Server-only, never sent to the browser. Without it, reports use the deterministic template explanation. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Any Groq chat model. |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible gateway/proxy. |
| `DATABASE_URL` | `file:./prisma/dev.db` | SQLite file for scan history. |
| `INTEL_MODE` | `demo` | `demo` = curated dataset; `live` adds real RDAP + HTTP inspection. |
| `SCAN_RATE_LIMIT_PER_MINUTE` | `12` | Per-client-IP scan rate limit. |

**Module 2** (`backend/.env`, see `backend/.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `TRUSTGRAPH_DATABASE_URL` | `sqlite:///./trustgraph_module2.db` | SQLite locally; PostgreSQL URL in production. |
| `TRUSTGRAPH_MODULE1_BASE_URL` | *(unset → MOCK adapter)* | Point at `http://localhost:3000` for the real Module 1 adapter. |
| `TRUSTGRAPH_MODULE3_BASE_URL` | *(unset → MOCK adapter)* | Point at `http://localhost:8001` for the real Module 3 adapter. |
| `TRUSTGRAPH_WORKER_MODE` | `in_process` | `in_process` (async jobs) or `sync` (deterministic, used by tests). |
| `TRUSTGRAPH_TEXT_MODEL` / `TRUSTGRAPH_VISUAL_MODEL` / `TRUSTGRAPH_IDENTITY_MODEL` | `char_ngram_tfidf` / `phash_hamming` / `token_similarity` | ML model selection per factor family (deterministic baselines; see `docs/modules/module-2/ML_ARCHITECTURE.md`). |
| `TRUSTGRAPH_ENVIRONMENT`, `TRUSTGRAPH_LOG_LEVEL` | `development`, `INFO` | Runtime/logging. |

**Module 3** (`module3/.env`, see `module3/.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `TRUSTGRAPH_M3_DATABASE_URL` | `sqlite:///./module3.db` | SQLite locally; PostgreSQL URL in production. |
| `TRUSTGRAPH_M3_LOG_LEVEL` | `INFO` | Logging. |

**Frontend** — no environment variables; the dev proxy table lives in
`frontend/vite.config.ts` (brands/health → :3000, entities/sources/healthz → :8001,
everything else under `/api/v1` + `/readyz` → :8000).

## Databases & migrations

| Module | Database | Migrations |
|---|---|---|
| Module 1 | `module1/prisma/dev.db` | `npm run setup` (Prisma `db push` + seed) — no migration files needed |
| Module 2 | `backend/trustgraph_module2.db` | `alembic upgrade head` in `backend/` (schema versioned; upgrade/downgrade cycle verified on a clean DB) |
| Module 3 | `module3/module3.db` | `alembic upgrade head` in `module3/` |

All three databases are gitignored. Reset any module by deleting its `.db` file and
re-running the migration/setup step.

---

## Demo walkthrough (~3 minutes, fully reproducible)

Everything below was executed end-to-end through the running UI before submission
(see [docs/TESTING.md](docs/TESTING.md) and [docs/screenshots/](docs/screenshots/)).

1. **Overview** (`/`) — live aggregates from all three modules: threat counts, severity
   mix, module health ("intel: demo · AI: template only" — the console reports what is
   actually running, not what could run).
2. **Entities** (`/entities`) → **Register entity**: create
   `ShopVerse Prize Portal (SYNTHETIC TEST_ONLY)` with domain
   `shopverse-prize-portal.example` and handle `shopverse_prizes`.
3. Open the entity → **Attach evidence**: create a source
   `synthetic-console-e2e (SYNTHETIC TEST_ONLY)` and attach a `TEXT_CONTENT` item
   ("Congratulations! You have won a ShopVerse prize. Verify your account within 24
   hours…") and a `DOMAIN_INTEL` item (`https://shopverse-prize-portal.example/claim`).
   The evidence timeline shows each item with its source, collection time and ids.
4. **Run analysis** (`/analysis/new`): pick **ShopVerse (demo)** as the protected
   brand (the console shows the derived risk-engine UUID) and the entity; the page
   previews the exact evidence that will be scored. Submit.
5. **Job page** (`/analysis/{id}`): polls until `COMPLETED` (~5 s locally), then shows
   the verdict — e.g. score **15/100 LOW**, Unclassified, confidence 46%, with a link
   to the threat.
6. **Threat detail** (`/threats/{id}`): the full breakdown — factor rows (points,
   0–100 family score, engine weight, confidence, **OBSERVED/DERIVED/INFERRED basis**,
   evidence count), evidence provenance resolved from Module 3 ("Used in" chips map
   each item to the factors it fed), a generated "Why this score" narrative, enrichment
   ("Scored for … against brand ShopVerse"), an explicit synthetic-data disclosure, and
   suggested next steps for the analyst. **Confirm threat** / **Dismiss** update the
   register (status filters on `/threats`).
7. For a richer verdict, the seeded fixture **NovaPay Support (SYNTHETIC TEST_ONLY)**
   entity (4 evidence items: text, visual hash, domain intel, behavioral event) scores
   **36/100 MEDIUM, phishing, 71% confidence** against NovaPay — see
   [docs/screenshots/03-threat-detail.png](docs/screenshots/03-threat-detail.png).
8. **Multi-brand** — create a second/third brand (e.g. Globex Financial) on `/brands`,
   then run the analysis flow again against it; the threat register mixes verdicts
   from every protected brand, and each brand's detail page lists its own scans and
   threats.
9. **Console scan (Module 1)** — `/scans/new` runs a Sentinel scan from the console;
   `/scans` lists history with type/level filters, and the scan detail page shows the
   full report with risk-over-time. The Overview dashboard renders Module 1's
   server-side stats (scan counts, avg risk/confidence, top signals).
10. **Registry pages** — `/sources` (source registry + creation form) and
    `/analysis/history` (job history with status filter and links to jobs/threats).

## Feature matrix

**Implemented and verified**
- Unified analyst console: Overview dashboard (live module health **plus Module 1
  server-side scan stats** — avg risk/confidence, top signals, recent scans), Brands
  (**create, edit and delete** non-demo brands with full Brand DNA forms; brand detail
  with Module 2 derived-UUID mapping, brand-scoped scans and threats-against-brand),
  Entities (register, **edit**, attach evidence with inline source creation,
  **search + entity-type filter**), Sources (dedicated registry page with full creation
  form), Scans (**new scan, scan list with type/level filters, scan detail with
  risk-over-time** — the Sentinel scan experience in the console), Run analysis
  (brand + entity pickers, evidence preview), live job status with polling/timeout/
  recovery, **Analysis history** (job list, status filter, links to jobs and threats),
  Threat register (search, status/risk filters, sort), Threat detail (factors,
  provenance, confidence, explanation, next steps, confirm/dismiss), 404 page,
  responsive nav **with mobile settings panel**, loading skeletons, empty states,
  inline validation, recoverable error states, accessible contrast/labels/roles.
- Async analysis jobs (202 + polling), idempotency keys, tenant isolation
  (`X-Tenant-ID`), evidence provenance end-to-end (source → evidence → factor →
  threat), observed vs inferred basis on every factor.
- Deterministic risk engine: seven weighted factor families, 0–100 score, four risk
  levels, confidence scoring, classification, engine version stamping.
- Brand DNA registry with derived-UUID bridge from Module 1 cuids.
- Full test suites: frontend 65/65, Module 2 119/119 (113-test floor preserved),
  Module 3 92/92, Module 1 typecheck + brand-input checks + engine self-check.

**Partially implemented (honest scope)**
- Relationship graph: factor families and relationship evidence are scored, but the
  console has no graph visualization (no entity-relationship link data exists yet).
- Module 1 `INTEL_MODE=live` (real RDAP/HTTP lookups) exists upstream but was run in
  `demo` mode for this submission; the console reports the live mode on the Overview.

**Planned / out of scope for this deadline**
- Live internet discovery connectors (no discovery results are invented — fixtures are
  labelled `SYNTHETIC TEST_ONLY`), multi-tenant auth/UI, PostgreSQL deployment, LLM
  explanations inside the risk engine (Module 1's Groq assessments cover the AI angle),
  notification/webhook integrations.

## Risk scoring, briefly

The engine (v1.0.0) scores seven factor families and sums the weighted contributions:

| Family | Weight | Typical inputs |
|---|---|---|
| Identity | 20% | handle/domain/app-name similarity to Brand DNA |
| Visual | 20% | perceptual-hash distance to official assets |
| Text | 15% | char n-gram TF-IDF similarity of page/bio text |
| Domain | 15% | registration age, WHOIS privacy, TLD, lexical distance |
| Behavioral | 10% | recent account creation, brand mimicry in bio |
| Reputation | 10% | threat-feed / blocklist floor |
| Relationship | 10% | links to other known-bad entities |

Risk levels: **LOW ≤ 25 < MEDIUM ≤ 50 < HIGH ≤ 75 < CRITICAL**. Confidence (0–100)
reflects evidence quality and coverage; each factor carries a **basis** marker —
`OBSERVED` (measured from evidence), `DERIVED` (computed from observations) or
`INFERRED` (model-derived). Full contract and field-by-field explanation:
[docs/API.md](docs/API.md). Engineering docs: [docs/modules/module-2/](docs/modules/module-2/).

## Testing

Run from each module's directory; full commands and captured output are in
[docs/TESTING.md](docs/TESTING.md).

| Suite | Command | Result |
|---|---|---|
| Frontend unit tests | `npm run test` | **65/65 passed** (8 files: format, API client, brand bridge, threat table, sources, scans, history, console workflows) |
| Frontend types | `npm run typecheck` | clean (TS 5.9 strict) |
| Frontend build | `npm run build` | ✓ (typecheck + production bundle) |
| Module 2 risk engine | `python -m pytest` | **119/119 passed** (113-test floor preserved) |
| Module 3 evidence store | `python -m pytest` | **92/92 passed** |
| Module 1 types | `npm run typecheck` | clean |
| Module 1 brand API checks | `npm run test:brands` | all checks passed |
| Module 1 engine self-check | `npm run test:engine` | all checks passed |

## Known limitations

- **Synthetic data only.** Modules run on clearly labelled `SYNTHETIC TEST_ONLY`
  fixtures; no live internet discovery is performed or claimed. Module 1 intel mode is
  `demo` and its AI provider is unconfigured (template explanations) unless a
  `GROQ_API_KEY` is set.
- **Evidence citation count.** A job result's `evidence_count` counts citations
  (an item counts once per factor family it fed), not distinct items — the UI labels
  this explicitly. Distinct-item counts appear on the threat/entity pages.
- **Single-node SQLite, in-process workers.** Right for the scope; swap the DATABASE_URLs
  to PostgreSQL and `TRUSTGRAPH_WORKER_MODE` for a server deployment.
- **Console is demo-tenant oriented.** One switchable tenant id in the UI; no auth.

## Documentation index

- [docs/API.md](docs/API.md) — every endpoint (Modules 1/2/3), request/response shapes,
  error semantics, and a field-by-field guide to the risk-scoring output.
- [docs/TESTING.md](docs/TESTING.md) — exact test/build commands and captured results.
- [docs/screenshots/](docs/screenshots/) — the 14-page UI walkthrough (overview,
  threats, threat detail, analysis, entities, brands, scans, sources, history, brand
  detail).
- [docs/COMPLETION_REPORT.md](docs/COMPLETION_REPORT.md) — final module-by-module
  report: audit gaps → delivered features, verification evidence, and remaining
  limitations.
- [docs/modules/module-2/](docs/modules/module-2/) — Module 2's engineering doc set
  (architecture, data model, risk engine, ML, events, security, testing, …).
- [module1/README.md](module1/README.md) — Sentinel DRP: setup, env vars, 3-minute
  standalone demo script, sample entities.
- [module3/README.md](module3/README.md) — Module 3: wire contract, ingestion API,
  normalization rules.
- Module 2 serves live OpenAPI docs at `http://localhost:8000/docs`; Module 3 at
  `http://localhost:8001/docs`.
