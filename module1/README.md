# Sentinel: AI Threat Intelligence & Risk Engine

A Digital Risk Protection platform that answers one question for any social profile, website, domain or mobile app:

> **How dangerous or suspicious is this entity, and why?**

Every result has three parts:

- a deterministic **Risk Score** (0–100) and **Risk Level**
- a **Confidence Score** (0–100)
- a transparent **breakdown into seven risk categories**, with evidence-backed signals, recommended actions, and an **AI assessment written by Groq that may only cite the collected evidence**

```
Entity Input → Intelligence Providers → Signal Normalization → Deterministic Risk Scoring
             → Confidence Calculation → Recommended Actions → Groq Explanation → Final Report
```

The score is final before the LLM runs. Groq can explain and prioritise; it cannot change a number or add evidence.

---

## Quick start

**Requirements:** Node.js 20.9+ (22 LTS recommended) and npm. Internet access is needed the first time, so `npm install` and Prisma can download their tooling.

```bash
# 1. Install dependencies (this also generates the Prisma client)
npm install

# 2. Configure environment
#    If this folder already has a .env with GROQ_API_KEY, keep it; nothing else is required.
#    Otherwise: cp .env.example .env   and set  GROQ_API_KEY=gsk_...

# 3. Create the SQLite database, load demo brands and run the sample scans
npm run setup

# 4. Start the app
npm run dev
```

Open **http://localhost:3000**.

On Windows PowerShell, use `copy .env.example .env` instead of `cp`. Optional variables all have defaults, listed below.

The SQLite driver (`better-sqlite3` v12) ships prebuilt binaries for Windows, macOS and Linux on current Node LTS versions, so no C++ build tools are needed.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build && npm start` | Production build and server |
| `npm run setup` | `prisma generate` + `prisma db push` + seed |
| `npm run db:seed -- --fresh` | Wipe scan history and re-run the sample scans |
| `npm run test:engine` | Runs every sample entity through the engine and checks expected risk bands, input validation and the AI grounding guard |
| `npm run typecheck` | TypeScript check |

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | For AI text | — | Groq key. **Server-only**: read from `process.env` in `src/lib/ai/groq.ts` (guarded by `server-only`) and never sent to the browser. Without it, reports use the deterministic template explanation. |
| `GROQ_MODEL` | No | `openai/gpt-oss-120b` | Any Groq chat model. `llama-3.3-70b-versatile` was retired in August 2026. |
| `GROQ_BASE_URL` | No | `https://api.groq.com/openai/v1` | Route through an OpenAI-compatible gateway or proxy. |
| `DATABASE_URL` | No | `file:./prisma/dev.db` | SQLite file for scan history. |
| `INTEL_MODE` | No | `demo` | `demo` uses the curated dataset. `live` adds real RDAP domain-age lookups and real HTTP redirect/page inspection. |
| `SCAN_RATE_LIMIT_PER_MINUTE` | No | `12` | Scans allowed per client IP per minute. |

---

## Demo script (about 3 minutes)

1. **Overview** (`/`): the threat queue. Sample scans are already loaded, and "Needs action" lists the latest high and critical entities.
2. **New analysis** (`/scan`): click ▶ next to **Credential-phishing page**. The pipeline stages animate, then the report opens.
3. On the report, point out:
   - **The score ruler.** The bar is built from coloured category segments that add up to the score, and the hatched segment is the explicit threat-feed floor.
   - **"Why is this risky?"** These are the top deterministic signals, each with its observed evidence.
   - **AI assessment (violet).** Groq's summary. Each finding has evidence chips (`S1`, `S2`…) that jump to the evidence cards.
   - **Recommended actions (blue).** Each action says which signals justify it.
   - **"How this score was calculated."** The literal sum, e.g. `20 + 15 + 14 + 15 + 15 + 9 + 10 = 98`.
   - **Confidence factors, intelligence sources and the pipeline trace** with per-stage timings.
4. Run the **Official domain (control)** sample. It scores **0 / Very Low**, and the mitigating evidence explains why.
5. Run **Unknown domain, no brand**. Only lexical analysis can run, so confidence drops below 50. The engine says what it doesn't know instead of guessing.
6. Click **Re-scan** on any report. The new scan appears in **Risk over time**.
7. **Scan history** (`/history`): filter by level or type, and search.
8. **Protected brands** (`/brands`): add your own brand, then analyse look-alikes against it.

### Sample entities

| Sample | Type | Input | Expected |
|---|---|---|---|
| Credential-phishing page | Website | `https://secure-novapay.verify-account.top/login` | Critical (98) |
| Homoglyph support domain | Domain | `n0vapay-support.com` | Critical (85, floor) |
| Fake support account | Profile | `https://instagram.com/novapay.support.help` | High (75) |
| Crypto airdrop scam | Profile | `telegram:novapay_airdrop` | Critical (85) |
| Malicious clone app | App | `com.novapay.wallet.secure` | Critical (84) |
| Reward scam on free hosting | Website | `https://novapay-rewards.netlify.app/claim` | High (62) |
| Giveaway page | Profile | `facebook:shopverse.giveaways` | Medium (56) |
| Look-alike outlet store | Domain | `shopverse-outlet-sale.shop` | Medium (45) |
| Official domain (control) | Domain | `novapay.com` | Very Low (0) |
| Official X account (control) | Profile | `x:novapay` | Very Low (0) |
| Official app (control) | App | `com.novapay.wallet` | Very Low (0) |
| Unknown domain, no brand | Domain | `parcel-redelivery-fee.info` | Very Low, low confidence |

NovaPay and ShopVerse are **fictional** brands. Demo hosting ASNs use the private 64512–65534 range, so no real company is tied to phishing.

---

## Architecture

```
src/
  app/                         Next.js App Router
    page.tsx                   Threat overview dashboard
    scan/                      Entity scanner
    scans/[id]/                Risk report (+ loading / not-found)
    history/                   Scan history
    brands/                    Protected brands
    api/
      scans/route.ts           POST run analysis · GET history
      scans/[id]/route.ts      GET report + target history · DELETE
      stats/route.ts           Dashboard aggregates
      brands/route.ts          GET / POST protected brands
      brands/[id]/route.ts     DELETE (non-demo) brand
      health/route.ts          Config & provider status (never the key)
  lib/
    engine/
      types.ts                 Entity, Signal, Score, Report contracts
      constants.ts             Category caps, severity points, level bands
      entity.ts                Zod validation + entity normalization
      similarity.ts            Levenshtein/OSA, homoglyph skeleton, brand matching
      lexicon.ts               Keyword, TLD, scam-phrase and permission lists
      providers/
        contracts.ts           Data shape each provider kind must return
        registry.ts            Provider selection per mode + parallel runner
        cache.ts               TTL cache for provider results
        local/                 url-analysis, brand-similarity (always real)
        live/                  RDAP + guarded HTTP inspector (INTEL_MODE=live)
        mock/                  Demo providers over src/lib/demo/dataset.ts
      rules/                   Signal normalization: facts → weighted signals
      scoring.ts               Deterministic score
      confidence.ts            Confidence score
      actions.ts               Deterministic recommended actions
      pipeline.ts              Orchestrates the stages + timing trace
    ai/
      prompt.ts                System prompt + evidence payload
      groq.ts                  Server-only Groq client (retries, concurrency gate)
      grounding.ts             Validates LLM output against the evidence
      fallback.ts              Deterministic template explanation
    demo/dataset.ts            Demo brands, intel records, sample entities
    scans.ts                   Persistence & queries
    rate-limit.ts              Per-client token bucket
  components/                  Report, scanner, history and brand UI
prisma/schema.prisma           Brand, Scan, Signal
scripts/engine-check.ts        Engine regression checks
```

### Database

| Model | Purpose |
|---|---|
| **Brand** | A protected brand or person: official domains, handles, app developers, package namespaces, keywords. |
| **Scan** | One analysis: normalized entity, score, level, confidence, category breakdown, floors, confidence factors, actions, AI assessment and its source, provider runs, pipeline trace, duration. Indexed on `(target, createdAt)` for risk-over-time comparison. |
| **Signal** | One explainable signal per row: rule id, category, severity, title, description, evidence, impact points, provider, data origin (`COMPUTED` / `LIVE` / `DEMO`). |

---

## Scoring methodology

### 1. Signals

Each rule in `src/lib/engine/rules/` turns provider facts into a signal with:

- a **fixed point value**, from LOW ≈ 4 to CRITICAL ≈ 20
- a **category**
- **concrete evidence** text

Mitigating evidence uses **negative** points: an official-asset match, platform verification, a domain older than 5 years, a clean reputation, or millions of installs.

### 2. Categories (caps sum to 100)

| Category | Cap | Examples |
|---|---|---|
| Impersonation | 20 | Official-asset mismatch, name claims brand, fake ✔, support impersonation, branded login form, developer mismatch, links to look-alikes |
| Brand Similarity | 15 | Homoglyph, typosquat, brand in name/subdomain/path, copied logo/avatar/icon |
| Identity | 15 | Account/listing age, hidden registrant, free-mail or look-alike contact |
| Domain / Website | 15 | Domain age, risky TLD, free hosting, brand + phishing keywords, lure words, IP/punycode host |
| Reputation & Threat Intel | 15 | Threat-feed listings, community reports, low app trust |
| Behavioral | 10 | Scam language, DM/off-platform solicitation, crypto "send-to-receive", bot-like audience, posting bursts |
| Technical | 10 | No TLS, suspicious redirects, credentials posted cross-domain, fresh cert, dangerous Android permissions, sideloading |

```
category points = clamp(Σ risk points − Σ mitigation points, 0, cap)
base score      = Σ category points
final score     = max(base score, explicit floors)
```

The only floor: a **confirmed malicious threat-feed listing raises the score to at least 85**. It is shown as a hatched segment in the ruler and stated in the score math.

**Levels:** 0–20 Very Low · 21–40 Low · 41–60 Medium · 61–80 High · 81–100 Critical.

### 3. Confidence (independent of risk)

| Factor | Max | Measures |
|---|---|---|
| Data coverage | 40 | Share of applicable providers that returned data (no-data counts 35%, failures 0) |
| Independent evidence | 25 | Distinct categories with evidence; four or more counts as full |
| Source reliability | 20 | Impact-weighted reliability of the sources behind the signals |
| Brand reference | 15 | Official assets supplied (15), name only (8), none (0) |
| Conflicting evidence | −10 | Strong risk and strong mitigating evidence at once |

The result is clamped to 5–97, so the engine never claims certainty.

### 4. AI layer: grounded by construction

- Groq receives only the structured results: signals with IDs and evidence, the fixed score, and the action IDs. It is told it must cite signal IDs and may not add facts or numbers.
- `grounding.ts` then **validates** the output:
  - findings citing unknown or no signal IDs are dropped
  - any number not present in the evidence rejects the text
  - a summary naming a different risk level is rejected
- Rejected or failed output (no key, timeout, 429 after retries, bad JSON) falls back to a deterministic template. The report labels which one you're seeing.

---

## Adding a real threat-intelligence provider

1. Implement `IntelProvider<T>` (see `src/lib/engine/types.ts`) for one of the kinds: `domain-intel`, `reputation`, `web-content`, `social-intel`, `app-intel`.
2. Map the vendor response onto that kind's contract in `providers/contracts.ts`.
3. Register it in `providers/registry.ts`, e.g. `if (process.env.VIRUSTOTAL_API_KEY) providers.push(virusTotalProvider)`.

The rules, scoring, confidence, AI layer and UI need no changes. Timeouts, failure isolation, caching and confidence accounting apply automatically.

---

## Safety & robustness

- **API key:** server-only module, never in client bundles or responses. `/api/health` reports only `configured: true/false`.
- **Rate limits:**
  - per-IP token bucket on `POST /api/scans`, returning `429` with `retry-after`
  - Groq concurrency cap (3) with `retry-after`-aware retries
  - per-provider timeouts
  - a 10-minute provider result cache
- **SSRF guard:** the live HTTP inspector refuses private, loopback and link-local addresses, caps redirects at 6 and reads at most 512 KB.
- **Validation:** Zod on every endpoint. Entity parsing rejects local/internal hosts, malformed domains, unknown platforms and invalid package names, with field-level messages in the UI.
- **Malicious URLs** are displayed defanged (`hxxps://…[.]top`), never as clickable links.
- **Failures are isolated:** a provider error or timeout lowers confidence but never fails the scan.

For multi-instance deployments, move the rate limiter and cache to Redis, and SQLite to Postgres (change the Prisma `provider` and adapter).
