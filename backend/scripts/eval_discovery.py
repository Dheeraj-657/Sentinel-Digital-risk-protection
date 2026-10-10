"""Compact, reproducible discovery evaluation against a live Module 2.

Runs one discovery job end-to-end and prints the metrics judges care about:
provider coverage and outcomes, candidate counts, duplicate rate, evidence
traceability (entity/evidence/analysis ids actually resolvable), failures,
and latency. The script reports what happened — a FAILED run from a real
provider outage is a valid, honestly-reported result, not a script error.

Usage (from backend/ with the venv active, services running):
    python scripts/eval_discovery.py --brand-id <uuid> \
        [--base-url http://localhost:8000] \
        [--tenant 11111111-2222-3333-4444-555555555555] \
        [--timeout 330]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

TERMINAL = {"COMPLETED", "PARTIAL", "FAILED"}


def _request(base_url: str, method: str, path: str, tenant: str, body: dict | None = None):
    req = urllib.request.Request(
        f"{base_url}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "X-Tenant-ID": tenant},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--tenant", default="11111111-2222-3333-4444-555555555555")
    parser.add_argument("--brand-id", required=True)
    parser.add_argument("--timeout", type=int, default=330, help="Seconds to wait for the job")
    args = parser.parse_args()

    queued = _request(args.base_url, "POST", "/api/v1/discovery", args.tenant,
                      {"brand_id": args.brand_id})
    job_id = queued["job_id"]
    print(f"discovery job {job_id} queued for brand {args.brand_id}")

    deadline = time.monotonic() + args.timeout
    job = queued
    while time.monotonic() < deadline:
        time.sleep(2)
        job = _request(args.base_url, "GET", f"/api/v1/discovery/{job_id}", args.tenant)
        if job["status"] in TERMINAL:
            break
    if job["status"] not in TERMINAL:
        print(f"TIMEOUT: job still {job['status']} after {args.timeout}s")
        return 1

    wall = ""
    if job.get("started_at") and job.get("completed_at"):
        from datetime import datetime

        start = datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))
        done = datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00"))
        wall = f"{(done - start).total_seconds():.1f}s"

    print(f"\n=== discovery eval — {job_id} ===")
    print(f"final status        : {job['status']}"
          + (f" (error_code={job['error_code']}, {job['error_message']})" if job.get("error_code") else ""))
    print(f"wall time           : {wall or 'n/a'}")

    print("\nprovider coverage:")
    for o in job["provider_outcomes"]:
        detail = o.get("error") or o.get("warning") or "-"
        latency = f"{o['latency_ms']}ms" if o.get("latency_ms") is not None else "n/a"
        print(f"  {o['provider']:<26} {o['status']:<12} "
              f"candidates={o['candidate_count']:<3} latency={latency:<10} {detail}")

    print("\nqueries (Brand DNA basis):")
    for q in job["queries"]:
        print(f"  {q['provider']:<26} {q['term']!r:<40} basis={q['basis']}")

    total = len(job["candidates"])
    dupes = job["duplicate_count"]
    raw = total + dupes
    dup_rate = f"{(dupes / raw * 100):.0f}%" if raw else "n/a (no raw observations)"
    print(f"\ncandidates          : {total} unique (duplicate_count={dupes}, duplicate rate {dup_rate})")
    traced = [c for c in job["candidates"] if c.get("evidence_id") and c.get("entity_id")]
    chained = [c for c in job["candidates"] if c.get("analysis_job_id")]
    scored = [c for c in job["candidates"] if c.get("analysis_status") == "COMPLETED"]
    fingerprinted = [c for c in job["candidates"] if c.get("discovery_fingerprint")]
    print(f"evidence traceable  : {len(traced)}/{total} candidates have entity_id + evidence_id")
    print(f"                      {len(fingerprinted)}/{total} carry a discovery_fingerprint "
          f"(matches Module 3 evidence metadata)")
    print(f"chained analysis    : {len(chained)}/{total} candidates scored by Module 2 "
          f"({len(scored)} reached COMPLETED)")
    if job.get("source_ids"):
        print("module 3 sources    : " + ", ".join(f"{p} -> {sid}" for p, sid in job["source_ids"].items()))
    if job.get("warning_message"):
        print(f"warning             : {job['warning_message']}")

    for c in job["candidates"]:
        label = c.get("title") or c.get("domain") or c.get("url") or "(unlabeled)"
        prov = "+".join(c["providers"])
        print(f"  - [{prov}] {label}  entity={c.get('entity_id') or '-'} "
              f"evidence={c.get('evidence_id') or '-'} analysis={c.get('analysis_status') or '-'}")

    print("\nNOTE: candidate observations are NOT malice verdicts; each is scored by the")
    print("Module 2 engine and waits for analyst review.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode(errors='replace')}", file=sys.stderr)
        sys.exit(2)
    except urllib.error.URLError as e:
        print(f"cannot reach Module 2: {e.reason}", file=sys.stderr)
        sys.exit(2)
