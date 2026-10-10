#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING TRUSTGRAPH stack (npm run dev first).
 *
 * Exercises the platform only through its public APIs — the same calls the
 * console makes — and asserts the cross-module behaviour:
 *   E2E-1 fake social profile   E2E-2 suspicious website   E2E-3 suspicious app
 *   E2E-4 threat graph links    E2E-5 AI analyst           E2E-6 unified workflow
 *
 * It writes clearly labelled "E2E SYNTHETIC" entities into the demo tenant.
 * Usage:  npm run e2e            (optionally TRUSTGRAPH_TENANT=<uuid>)
 */
import { createHash, randomBytes } from "node:crypto";

const M1 = process.env.M1_URL ?? "http://127.0.0.1:3000";
const M2 = process.env.M2_URL ?? "http://127.0.0.1:8000";
const M3 = process.env.M3_URL ?? "http://127.0.0.1:8001";
const UI = process.env.UI_URL ?? "http://127.0.0.1:5173";
const TENANT = process.env.TRUSTGRAPH_TENANT ?? "11111111-2222-3333-4444-555555555555";
const OTHER_TENANT = "99999999-0000-4000-8000-000000000099";
const RUN = randomBytes(3).toString("hex");
const LABEL = "E2E SYNTHETIC";

let failures = 0;
const results = [];
function check(id, name, pass, detail = "") {
  results.push({ id, name, pass, detail });
  if (!pass) failures++;
  console.log(`${pass ? "✔" : "✘"} [${id}] ${name}${detail ? `  — ${detail}` : ""}`);
}

async function call(base, path, { method = "GET", body, tenant = TENANT, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(tenant ? { "X-Tenant-ID": tenant } : {}),
      // Module 1 rate-limits scans per client IP; give each call its own bucket.
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

/** uuid5 (RFC 4122) — mirrors the console/backend Module 1 → Module 2 brand bridge. */
function uuid5(name, namespace) {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const bridgeBrand = (cuid) => uuid5(cuid, uuid5("trustgraph.module1.sentinel", NAMESPACE_DNS));

async function analyze(brandUuid, entityId) {
  const job = await call(M2, "/api/v1/analysis", { method: "POST", body: { brand_id: brandUuid, entity_id: entityId } });
  if (job.status !== 202) return { job };
  for (let i = 0; i < 60; i++) {
    const r = await call(M2, `/api/v1/analysis/${job.json.job_id}`);
    if (["COMPLETED", "FAILED"].includes(r.json?.status)) return { job: r };
    await new Promise((res) => setTimeout(res, 500));
  }
  return { job: { status: 0, json: { status: "TIMEOUT" } } };
}

async function entityWithEvidence(sourceId, entity, evidence) {
  const e = await call(M3, "/api/v1/entities", { method: "POST", body: entity });
  if (e.status !== 201) throw new Error(`entity create ${e.status}: ${e.text.slice(0, 200)}`);
  for (const ev of evidence) {
    const r = await call(M3, `/api/v1/entities/${e.json.entity_id}/evidence`, { method: "POST", body: { source_id: sourceId, ...ev } });
    if (r.status !== 201) throw new Error(`evidence create ${r.status}: ${r.text.slice(0, 200)}`);
  }
  return e.json;
}

async function main() {
  console.log(`TRUSTGRAPH E2E smoke — run ${RUN}, tenant ${TENANT}\n`);

  // ---- preflight
  const health = await Promise.all([
    call(M1, "/api/health", { tenant: null }).catch(() => ({ status: 0 })),
    call(M2, "/readyz", { tenant: null }).catch(() => ({ status: 0 })),
    call(M3, "/healthz", { tenant: null }).catch(() => ({ status: 0 })),
    call(UI, "/", { tenant: null }).catch(() => ({ status: 0 })),
  ]);
  const down = ["Module 1", "Module 2", "Module 3", "Console"].filter((_, i) => health[i].status !== 200);
  if (down.length) {
    console.error(`✘ not running: ${down.join(", ")} — start the stack with  npm run dev`);
    process.exit(2);
  }

  const brands = (await call(M1, "/api/brands", { tenant: null })).json?.items ?? [];
  const nova = brands.find((b) => b.name === "NovaPay");
  if (!nova) {
    console.error("✘ NovaPay demo brand missing in Module 1 — run  npm run setup");
    process.exit(2);
  }
  const brandUuid = bridgeBrand(nova.id);
  const source = await call(M3, "/api/v1/sources", { method: "POST", body: { name: `e2e-smoke ${RUN} (${LABEL})`, kind: "fixture" } });
  const sourceId = source.json.source_id;
  const sharedDomain = `novapay-help-${RUN}.example`;

  // ---- E2E-1 fake profile
  const scanP = await call(M1, "/api/scans", { method: "POST", tenant: null, body: { entityType: "PROFILE", input: "instagram:novapay.support.help", brandId: nova.id } });
  check("E2E-1", "Module 1 scores a look-alike social profile", scanP.status === 201 && ["MEDIUM", "HIGH", "CRITICAL"].includes(scanP.json?.riskLevel), `${scanP.json?.riskLevel} ${scanP.json?.riskScore}/100`);
  const profile = await entityWithEvidence(sourceId, {
    entity_type: "SOCIAL_PROFILE",
    display_name: `NovaPay Support Help ${RUN} (${LABEL})`,
    identifiers: { handle: `novapay_support_${RUN}`, domain: sharedDomain },
    attributes: { label: LABEL },
  }, [
    { evidence_type: "TEXT_CONTENT", text: "NovaPay official support. DM us your card number and OTP to verify your account now." },
    { evidence_type: "BEHAVIORAL_EVENT", metadata: { recent_account_creation: true, high_post_frequency: true, brand_mimicry_in_bio: true } },
    { evidence_type: "IDENTITY_MATCH", text: "NovaPay Support", metadata: { claimed_name: "NovaPay Support" } },
  ]);
  const p = await analyze(brandUuid, profile.entity_id);
  const pThreat = p.job.json?.result;
  check("E2E-1", "Risk engine verdict for the registered profile", p.job.json?.status === "COMPLETED" && !!pThreat, pThreat ? `${pThreat.risk_level} ${pThreat.risk_score}/100 ${pThreat.classification}` : JSON.stringify(p.job.json).slice(0, 160));

  // ---- E2E-2 suspicious website
  const scanW = await call(M1, "/api/scans", { method: "POST", tenant: null, body: { entityType: "WEBSITE", input: "https://n0vapay-secure-login.com/verify", brandId: nova.id } });
  // In demo intel mode an unknown site has no crawl/WHOIS/feed data: it must then be flagged
  // as unverified (never cleared), while the look-alike signal is still raised.
  const wActs = (scanW.json?.recommendedActions ?? []).map((x) => x.action);
  const wLookalike = (scanW.json?.signals ?? []).some((x) => /look-alike/i.test(x.title));
  check("E2E-2", "Module 1 flags a look-alike website (risky, or explicitly unverified)",
    scanW.status === 201 && wLookalike && (["MEDIUM", "HIGH", "CRITICAL"].includes(scanW.json?.riskLevel) || wActs.includes("Collect missing intelligence before clearing")),
    `${scanW.json?.riskLevel} ${scanW.json?.riskScore}/100; ${wActs.join(" | ")}`);
  for (const target of ["http://127.0.0.1:8000/readyz", "http://169.254.169.254/latest/meta-data/", "http://[::ffff:7f00:1]/"]) {
    const r = await call(M1, "/api/scans", { method: "POST", tenant: null, body: { entityType: "WEBSITE", input: target } });
    check("E2E-2", `SSRF: internal target refused (${target})`, r.status === 400, `${r.status} ${r.json?.error?.message ?? ""}`);
  }
  const site = await entityWithEvidence(sourceId, {
    entity_type: "WEBSITE",
    display_name: `NovaPay Secure Login ${RUN} (${LABEL})`,
    identifiers: { domain: `novapay-secure-${RUN}.example` },
    attributes: { label: LABEL },
  }, [
    { evidence_type: "DOMAIN_INTEL", url: `https://novapay-secure-${RUN}.example/login`, metadata: { days_since_registration: 3, whois_privacy: true } },
    { evidence_type: "TEXT_CONTENT", text: "NovaPay secure login. Your account is suspended, verify your password immediately." },
  ]);
  const w = await analyze(brandUuid, site.entity_id);
  const wThreat = w.job.json?.result;
  check("E2E-2", "Risk engine verdict for the registered website", w.job.json?.status === "COMPLETED" && !!wThreat, wThreat ? `${wThreat.risk_level} ${wThreat.risk_score}/100 ${wThreat.classification}` : "");

  // ---- E2E-3 suspicious app
  const scanA = await call(M1, "/api/scans", { method: "POST", tenant: null, body: { entityType: "APP", input: "com.novapay.wallet.secure", brandId: nova.id, claimedDeveloper: "Nova Pay Wallet Ltd" } });
  check("E2E-3", "Module 1 scores a clone app", scanA.status === 201 && ["HIGH", "CRITICAL"].includes(scanA.json?.riskLevel), `${scanA.json?.riskLevel} ${scanA.json?.riskScore}/100`);
  const scanU = await call(M1, "/api/scans", { method: "POST", tenant: null, body: { entityType: "APP", input: `com.novapay.rewards.r${RUN}`, brandId: nova.id } });
  const uActs = (scanU.json?.recommendedActions ?? []).map((a) => a.action);
  check("E2E-3", "App with no store data is NOT reported as safe", scanU.status === 201 && uActs.includes("Collect missing intelligence before clearing"), `${scanU.json?.riskLevel} ${scanU.json?.riskScore}/100; actions: ${uActs.join(" | ")}`);
  const app = await entityWithEvidence(sourceId, {
    entity_type: "MOBILE_APP",
    display_name: `NovaPay Rewards App ${RUN} (${LABEL})`,
    identifiers: { package: `com.novapay.rewards.r${RUN}`, domain: sharedDomain },
    attributes: { label: LABEL },
  }, [
    { evidence_type: "IDENTITY_MATCH", text: "NovaPay Rewards", metadata: { claimed_developer: "Nova Pay Rewards Team" } },
    { evidence_type: "TEXT_CONTENT", text: "Claim your NovaPay reward. Log in with your NovaPay password to receive cashback." },
  ]);
  const a = await analyze(brandUuid, app.entity_id);
  const aThreat = a.job.json?.result;
  check("E2E-3", "Risk engine verdict for the registered app", a.job.json?.status === "COMPLETED" && !!aThreat, aThreat ? `${aThreat.risk_level} ${aThreat.risk_score}/100 ${aThreat.classification}` : "");

  // ---- E2E-4 threat graph
  if (pThreat && aThreat && wThreat) {
    const rel = await call(M2, `/api/v1/threats/${pThreat.threat_id}/related`);
    const link = rel.json?.items?.find((i) => i.threat_id === aThreat.threat_id);
    check("E2E-4", "Profile and app linked by their exact shared domain", !!link && link.basis === "EXACT_ATTRIBUTE_MATCH" && link.shared_attribute?.value === sharedDomain, link ? `${link.relation_type} ${link.shared_attribute.key}=${link.shared_attribute.value}` : JSON.stringify(rel.json).slice(0, 160));
    check("E2E-4", "Unrelated website is not linked (no invented edges)", !rel.json?.items?.some((i) => i.threat_id === wThreat.threat_id));
    const cross = await call(M2, `/api/v1/threats/${pThreat.threat_id}/related`, { tenant: OTHER_TENANT });
    check("E2E-4", "Relations are tenant-isolated", cross.status === 404, `${cross.status}`);
  }

  // ---- E2E-5 AI analyst
  if (pThreat && aThreat && wThreat) {
    const why = await call(M2, "/api/v1/investigation/analyst", { method: "POST", body: { question: "Why was this entity classified this way?", threat_id: pThreat.threat_id } });
    check("E2E-5", "Analyst explains with the stored score and cited evidence", why.status === 200 && why.json.answer.includes(`${pThreat.risk_score}/100`) && why.json.citations.evidence_ids.length > 0 || (why.json?.source === "GROQ" && why.json.citations.evidence_ids.length > 0), `${why.json?.source} ${why.json?.intent}, ${why.json?.citations?.evidence_ids?.length} evidence cited`);
    const cmp = await call(M2, "/api/v1/investigation/analyst", { method: "POST", body: { question: "Compare these two reports", threat_id: pThreat.threat_id, compare_threat_id: wThreat.threat_id } });
    check("E2E-5", "Analyst compares two reports", cmp.status === 200 && cmp.json.intent === "compare", `${cmp.json?.source}`);
    const camp = await call(M2, "/api/v1/investigation/analyst", { method: "POST", body: { question: "Summarize a potential campaign", cluster_threat_ids: [pThreat.threat_id, aThreat.threat_id, wThreat.threat_id] } });
    const ans = camp.json?.answer ?? "";
    check("E2E-5", "Campaign summary groups only linked members and is not 'confirmed'",
      camp.status === 200 && camp.json.intent === "campaign" && (camp.json.source === "GROQ" || (ans.includes("not a confirmed campaign") && ans.includes(sharedDomain) && ans.includes("Not linked to any other member"))),
      `${camp.json?.source}`);
    const xt = await call(M2, "/api/v1/investigation/analyst", { method: "POST", tenant: OTHER_TENANT, body: { question: "why?", threat_id: pThreat.threat_id } });
    check("E2E-5", "Analyst refuses another tenant's threat", xt.status === 404, `${xt.status}`);
    const st = await call(M2, "/api/v1/investigation/analyst/status", { tenant: null });
    check("E2E-5", "Analyst status never exposes the API key", st.status === 200 && !/gsk_|api_key"\s*:\s*"[^"]/i.test(st.text), `${st.json?.llm_provider} configured=${st.json?.llm_configured}`);
  }

  // ---- E2E-6 unified workflow through the console's own proxy
  const viaUi = await Promise.all([
    call(UI, "/api/brands", { tenant: null }),
    call(UI, `/api/v1/threats?limit=5`),
    call(UI, `/api/v1/entities/${profile.entity_id}`),
    pThreat ? call(UI, `/api/v1/threats/${pThreat.threat_id}`) : Promise.resolve({ status: 0 }),
  ]);
  check("E2E-6", "Console reaches all three services through one origin", viaUi.every((r) => r.status === 200), viaUi.map((r) => r.status).join(","));
  const disc = await call(M2, "/api/v1/discovery", { method: "POST", body: { brand_id: brandUuid } });
  let dj = disc.json;
  for (let i = 0; i < 60 && dj && !["COMPLETED", "PARTIAL", "FAILED"].includes(dj.status); i++) {
    await new Promise((res) => setTimeout(res, 1000));
    dj = (await call(M2, `/api/v1/discovery/${disc.json.job_id}`)).json;
  }
  const outcomes = (dj?.provider_outcomes ?? []).map((o) => `${o.provider}:${o.status}`).join(", ");
  check("E2E-6", "Discovery runs and reports every provider outcome honestly", ["COMPLETED", "PARTIAL", "FAILED"].includes(dj?.status) && (dj?.provider_outcomes ?? []).length > 0, `${dj?.status}; ${outcomes}`);

  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed${failures ? `, ${failures} failed` : ""}.`);
  console.log(`Created (labelled ${LABEL}): ${[profile, site, app].map((e) => e.entity_id).join(", ")}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("✘ E2E aborted:", err.message);
  process.exit(1);
});
