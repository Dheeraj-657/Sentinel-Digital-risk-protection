# Deploying TRUSTGRAPH — Vercel (console) + Render (three services)

```
User ─► Vercel: TRUSTGRAPH console (frontend/, static Vite build)
           │  frontend/vercel.json rewrites — same paths as the local Vite proxy
           ├─ /api/brands/*, /api/health, /api/scans/*, /api/stats ─► trustgraph-module1 (Render)
           ├─ /api/v1/entities/*, /api/v1/sources/*, /healthz ──────► trustgraph-module3 (Render)
           └─ /api/v1/*, /readyz ───────────────────────────────────► trustgraph-module2 (Render)
trustgraph-module2 ─► module1 (brand DNA: /api/brands) and module3 (entities/evidence)
module1 and module2 ─► Groq (only if GROQ_API_KEY is set)
```

The browser only ever talks to the Vercel origin; Vercel forwards API calls server-side.
No CORS settings are needed and no backend URL or secret is in the frontend bundle.

## 1. Service map

| Render service | Root dir | Runtime | Start (from `render.yaml`) | Health check | Data (persistent disk `/var/data`) |
|---|---|---|---|---|---|
| `trustgraph-module1` Brand intelligence + Sentinel scans | `module1/` | Node 22 · Next.js 16 · Prisma 7 | `npx prisma db push && npm run start` | `/api/health` | `sentinel.db` (brands, scans) |
| `trustgraph-module3` Entities, evidence, sources | `module3/` | Python 3.13 · FastAPI | `alembic upgrade head && uvicorn module3.main:app` | `/healthz` | `module3.db` |
| `trustgraph-module2` Risk engine, discovery, relations, **AI Security Analyst** | `backend/` | Python 3.13 · FastAPI | `alembic upgrade head && uvicorn app.main:app` | `/readyz` (database **and** integrations configured) | `trustgraph_module2.db` |

Each database belongs to exactly one service; they are never shared. Schema setup runs at
boot because Render disks are not mounted during build; both commands are idempotent and
non-destructive (verified: restart keeps all rows). Nothing is seeded automatically.

## 2. Environment variables

Set by `render.yaml` (no action needed): `DATABASE_URL`, `INTEL_MODE=demo`,
`SCAN_RATE_LIMIT_PER_MINUTE`, `GROQ_MODEL` (module1); `TRUSTGRAPH_M3_*` (module3);
`TRUSTGRAPH_ENVIRONMENT=production`, `TRUSTGRAPH_DATABASE_URL`, `TRUSTGRAPH_WORKER_MODE`,
model ids, `TRUSTGRAPH_MODULE1_BASE_URL`, `TRUSTGRAPH_MODULE3_BASE_URL`, `GROQ_MODEL` (module2);
`NODE_VERSION` / `PYTHON_VERSION`.

Secrets — Render asks for these when you create the Blueprint (never commit them):

| Service | Variable | Required? |
|---|---|---|
| module1 | `GROQ_API_KEY` | optional — AI explanations on scan reports; template otherwise |
| module2 | `GROQ_API_KEY` | optional — AI Security Analyst answers; template otherwise |
| module2 | `TRUSTGRAPH_DISCOVERY_SEARCH_API_KEY` | optional — Brave web-search discovery provider |

Vercel needs **no** environment variables.

## 3. Deploy

**Render**
1. Push the repository (including `render.yaml` and `frontend/vercel.json`) to GitHub.
2. Render → **New → Blueprint** → select the repo → Render lists the three services.
3. Enter the secrets above (or leave blank) → **Apply**. Plan: `starter` (persistent disks
   need a paid instance; ~US$7/month per service + 1 GB disk each).
4. When all three are *Live*, open each service page and check its URL. It should be
   `https://trustgraph-module1.onrender.com`, `…-module2…`, `…-module3…`.
   **If Render added a suffix** (name already taken), replace that hostname in
   `render.yaml` (`TRUSTGRAPH_MODULE1_BASE_URL` / `TRUSTGRAPH_MODULE3_BASE_URL`) **and** in
   `frontend/vercel.json`, push, and let both redeploy.
5. Optional demo brands: in `trustgraph-module1` → **Shell**, run `npm run db:seed`
   (adds NovaPay/ShopVerse demo brands; it also clears Module 1's scan history).
   Otherwise create brands in the console under *Brand intelligence*.

**Vercel** (existing project `sentinel-digital-risk-protection`)
1. Settings → General → **Root Directory = `frontend`** (so `frontend/vercel.json` is used).
   Framework preset Vite, build `npm run build`, output `dist` (also set in `vercel.json`).
2. Redeploy. Nothing else changes; the domain is preserved.

## 4. Verify (after deploying)

| Check | Expected |
|---|---|
| `https://trustgraph-module1.onrender.com/api/health` | `{"status":"ok","database":"ok",…}` |
| `https://trustgraph-module3.onrender.com/healthz` | `{"status":"ok","service":"module3",…}` |
| `https://trustgraph-module2.onrender.com/readyz` | `{"status":"ready","checks":{"database":"ok"}}` |
| `https://sentinel-digital-risk-protection.vercel.app/readyz`, `/healthz`, `/api/health` | same three bodies, via Vercel |
| Console sidebar | Risk engine / Evidence store / Brand service: **up** |
| Reload on `/investigate` | the app, not a 404 |
| Full flow | `M1_URL=https://sentinel-digital-risk-protection.vercel.app M2_URL=… M3_URL=… UI_URL=… npm run e2e` (all four set to the Vercel URL) — needs the NovaPay brand (step 5) |

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Console shows 404 for `/api/…` | Vercel Root Directory is not `frontend`, or `vercel.json` not deployed |
| Sidebar "down" + 502 `SERVICE_UNAVAILABLE`/`ROUTER_EXTERNAL_TARGET_ERROR` | the Render hostname in `vercel.json` is wrong or the service is not Live |
| module2 deploy fails health check, `/readyz` → `"integrations":"not_configured"` | a module URL is blank — set both base URLs |
| Analysis jobs `FAILED INTEGRATION_UNAVAILABLE` | module2's base URL for module1/3 is wrong or that service is down |
| Analysis `FAILED MISSING_BRAND_DNA` | the brand is not registered in module1 |
| Discovery providers `FAILED` | crt.sh / Cert Spotter unreachable or rate-limited at that moment; reported, never invented |
| Data disappears after redeploy | a disk was removed or `plan: free` used (free plans have no disks) |

## 6. What was verified before deployment (2026-10-11)

Production rehearsal on one machine: each service started with its `render.yaml` start
command and environment on **empty** databases; the built console served exactly per
`frontend/vercel.json` (static first, then rewrites in order) with the three Render
hostnames mapped to local ports.

- All rewrite targets answered through the single origin; `/investigate/<id>` served the SPA.
- `npm run e2e` through that origin: **20/20** (brand DNA from module1 used by module2
  verdicts, evidence from module3, relations, analyst, SSRF refusals, discovery outcomes).
- Browser: 11 pages, no crash, sidebar showed all three services up.
- module2 with blank integration URLs in production: `/readyz` → 503 `not_configured`.
- Restart on the same database: migrations no-op, rows kept.
- Module 1 `next build` succeeds with no database present (as on Render's build machine).
- Tests: backend 179, console 153 (incl. 27 routing checks that every API path the client
  calls reaches the same module in production as in local dev).

Not verifiable from the build environment: the real Render and Vercel deployments
(no account access; outbound access to `*.onrender.com` / `*.vercel.app` blocked) and
`prisma db push` (Prisma engine download blocked here; it runs normally on Render).
