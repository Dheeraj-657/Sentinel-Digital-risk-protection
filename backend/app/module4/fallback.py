"""Deterministic analyst answers, composed only from the grounded context.

Used when no LLM is configured, the provider fails, or a model answer is
rejected by the grounding guard. Every sentence is a restatement of a stored
record, with inline citations, so this path cannot invent evidence.
"""
from __future__ import annotations

import re
from typing import Any

from app.module4.context import AnalystContext, Subject

INTENTS = ("campaign", "compare", "relations", "evidence", "next_steps", "why", "summary")

_INTENT_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("compare", re.compile(r"\b(compare|comparison|versus|vs\.?|difference|differ)\b", re.I)),
    ("relations", re.compile(r"\b(connect\w*|relat\w*|link\w*|campaign|cluster|shar\w*|graph|associated)\b", re.I)),
    ("next_steps", re.compile(r"\b(next|should|recommend\w*|investigate|todo|to do|action|steps?)\b", re.I)),
    ("evidence", re.compile(r"\b(evidence|proof|support\w*|observ\w*|source|provenance)\b", re.I)),
    ("why", re.compile(r"\b(why|reason|explain|classif\w*|score|risky|risk)\b", re.I)),
    ("summary", re.compile(r"\b(summar\w*|overview|brief|tl;?dr)\b", re.I)),
]


_CAMPAIGN_RE = re.compile(r"\b(campaigns?|clusters?|coordinated|operation)\b", re.I)


def detect_intent(question: str, has_compare: bool, has_cluster: bool = False) -> str:
    if has_cluster:
        return "campaign"
    if has_compare:
        return "compare"
    if _CAMPAIGN_RE.search(question):
        return "campaign"
    for intent, pattern in _INTENT_PATTERNS:
        if intent == "compare":
            continue
        if pattern.search(question):
            return intent
    return "summary"


def _ev(evidence_id: str) -> str:
    return f"[ev:{evidence_id}]"


def _cite_all(ids: list[str], limit: int = 4) -> str:
    unique = list(dict.fromkeys(ids))[:limit]
    return " ".join(_ev(i) for i in unique)


def _name(subject: Subject) -> str:
    if subject.entity and subject.entity.get("display_name"):
        return str(subject.entity["display_name"])
    if subject.entity:
        return subject.entity["entity_id"]
    if subject.threat:
        return f"entity {subject.threat['entity_id']}"
    return "this entity"


def _brand_name(subject: Subject) -> str:
    return subject.brand["name"] if subject.brand else "the protected brand"


def _human(value: str) -> str:
    return value.replace("_", " ").lower()


def _verdict_line(s: Subject) -> str:
    t = s.threat
    assert t is not None
    return (
        f"{_name(s)} [entity:{t['entity_id']}] is rated {t['risk_level']} risk with a risk score of "
        f"{t['risk_score']}/100 against {_brand_name(s)} [threat:{t['threat_id']}], classified as "
        f"{_human(t['classification'])}, with {t['confidence_percent']}% confidence. Analyst status: "
        f"{t['status'].lower()}."
    )


def _factor_lines(s: Subject, limit: int = 4) -> list[str]:
    t = s.threat
    assert t is not None
    lines = []
    for f in t["factors"][:limit]:
        cites = _cite_all(f["evidence_ids"])
        lines.append(
            f"- {f['label'].capitalize()}: {f['points_contributed']} points "
            f"(family score {f['score']}/100 × weight {f['weight_percent']}%, "
            f"{f['confidence_percent']}% confidence, basis {f['basis'].lower()}). {cites}".rstrip()
        )
    return lines


def _evidence_usage(s: Subject) -> dict[str, list[str]]:
    usage: dict[str, list[str]] = {}
    if s.threat:
        for f in s.threat["factors"]:
            for eid in f["evidence_ids"]:
                usage.setdefault(eid, []).append(f["label"])
    return usage


def _evidence_line(item: dict[str, Any], used_in: list[str]) -> str:
    detail = item.get("url") or item.get("text") or (
        f"image hash {item['image_hash']}" if item.get("image_hash") else None
    )
    if not detail and item.get("metadata"):
        detail = ", ".join(f"{k}={v}" for k, v in list(item["metadata"].items())[:3])
    collected = (item.get("collected_at") or "")[:10]
    used = f" Used in: {', '.join(used_in)}." if used_in else " Not cited by any risk factor."
    return (
        f"- {_human(item['evidence_type']).capitalize()}, collected {collected}: "
        f"\"{detail or 'no content recorded'}\".{used} {_ev(item['evidence_id'])}"
    )


# ---------------------------------------------------------------- intents


def _why(ctx: AnalystContext) -> list[str]:
    s = ctx.subjects[0]
    if not s.threat:
        return [
            f"There is no risk-engine verdict for {_name(s)} yet, so there is no score or "
            "classification to explain. Run an analysis to score the stored evidence."
        ] + _evidence_section(s)
    lines = [_verdict_line(s), "", "What drives the score (from the risk engine's stored factors):"]
    lines += _factor_lines(s) or ["- No risk factors were recorded."]
    absent = s.threat["factor_families_without_signal"]
    if absent:
        lines += ["", f"No signal was recorded for: {', '.join(absent)}. Those families did not contribute."]
    return lines


def _evidence_section(s: Subject) -> list[str]:
    if not s.evidence:
        return ["No evidence items are stored for this entity."]
    usage = _evidence_usage(s)
    return [f"Stored evidence for {_name(s)} (collected data, treated as untrusted content):"] + [
        _evidence_line(item, usage.get(item["evidence_id"], [])) for item in s.evidence
    ]


def _evidence(ctx: AnalystContext) -> list[str]:
    s = ctx.subjects[0]
    lines = []
    if s.threat:
        lines += [_verdict_line(s), ""]
    lines += _evidence_section(s)
    return lines


def _relations(ctx: AnalystContext) -> list[str]:
    s = ctx.subjects[0]
    if not s.threat:
        return [
            f"Relations are computed between risk-engine verdicts, and {_name(s)} has none yet. "
            "Run an analysis first."
        ]
    distinct = [r for r in s.related if not r["same_entity"]]
    same = [r for r in s.related if r["same_entity"]]
    lines = [
        "Relations come from the risk engine's exact stored-attribute match "
        "(basis EXACT_ATTRIBUTE_MATCH). Name similarity is never used."
    ]
    if distinct:
        lines += ["", "Other entities sharing an identifier with this one:"]
        for r in distinct:
            attr = r["shared_attribute"]
            lines.append(
                f"- {r['entity_display_name'] or r['entity_id']} [entity:{r['entity_id']}] shares "
                f"{attr['key']} \"{attr['value']}\" ({_human(r['relation_type'])}) "
                f"[threat:{r['threat_id']}] {_cite_all(r['evidence_ids'] + r['target_evidence_ids'])}".rstrip()
            )
    else:
        lines += ["", "No other entity shares an identifier with this one."]
    if same:
        lines += [
            "",
            f"The same entity was also scored against other brands ({len(same)} identifier matches "
            "on its own verdicts):",
        ]
        seen = set()
        for r in same:
            if r["threat_id"] in seen:
                continue
            seen.add(r["threat_id"])
            lines.append(f"- [threat:{r['threat_id']}]")
    lines += [
        "",
        "Campaign detection is not implemented in the risk engine; shared identifiers indicate a "
        "possible link for review, not a confirmed campaign.",
    ]
    return lines


def _next_steps(ctx: AnalystContext) -> list[str]:
    s = ctx.subjects[0]
    steps: list[str] = []
    if not s.threat:
        steps.append("Run a risk-engine analysis for this entity against the relevant protected brand.")
        if not s.evidence:
            steps.append("Attach evidence first: the engine can only score what is stored.")
    else:
        t = s.threat
        if t["status"] == "OPEN":
            steps.append(
                f"Review the factors and evidence, then confirm or dismiss the verdict [threat:{t['threat_id']}]."
            )
        if t["confidence_percent"] < 50:
            steps.append(
                f"Confidence is {t['confidence_percent']}%: collect more evidence before acting on the verdict."
            )
        absent = t["factor_families_without_signal"]
        if absent:
            steps.append(f"Collect evidence for families with no signal: {', '.join(absent)}.")
        domain_ev = [e for e in s.evidence if e["evidence_type"] == "DOMAIN_INTEL" and e.get("url")]
        for e in domain_ev[:2]:
            steps.append(
                f"Verify registration details (WHOIS/RDAP) for {e['url']} before any takedown request. {_ev(e['evidence_id'])}"
            )
        for r in [r for r in s.related if not r["same_entity"]][:3]:
            steps.append(
                f"Investigate the linked entity {r['entity_display_name'] or r['entity_id']} "
                f"[entity:{r['entity_id']}], which shares {r['shared_attribute']['key']} \"{r['shared_attribute']['value']}\"."
            )
        if t["risk_level"] in ("HIGH", "CRITICAL"):
            steps.append(
                "If confirmed, prepare an impersonation report or takedown request through the "
                "platform or registrar. TRUSTGRAPH does not submit these automatically."
            )
    lines = ["Suggested next steps (recommendations only; nothing has been executed):"]
    lines += [f"- {step}" for step in steps] or ["- No further steps are indicated by the stored data."]
    return lines


def _compare(ctx: AnalystContext) -> list[str]:
    if len(ctx.subjects) < 2:
        return ["A second threat is needed for a comparison. Select one in the workspace."]
    a, b = ctx.subjects[0], ctx.subjects[1]
    lines = ["Side-by-side, from the stored verdicts:"]
    for s in (a, b):
        if s.threat:
            lines.append(f"- {_verdict_line(s)}")
            top = s.threat["factors"][:1]
            if top:
                f = top[0]
                lines.append(
                    f"  Largest factor: {f['label']} ({f['points_contributed']} points). {_cite_all(f['evidence_ids'], 2)}".rstrip()
                )
            lines.append(f"  Stored evidence items: {len(s.evidence)}.")
    ids_a = (a.entity or {}).get("identifiers", {})
    ids_b = (b.entity or {}).get("identifiers", {})
    shared = [(k, v) for k, v in ids_a.items() if ids_b.get(k) == v]
    if a.entity and b.entity and a.entity["entity_id"] == b.entity["entity_id"]:
        lines.append("Both verdicts are for the same entity, scored against different brands.")
    elif shared:
        lines.append(
            "Exact shared identifiers: " + ", ".join(f"{k} \"{v}\"" for k, v in shared) + "."
        )
    else:
        lines.append("The two entities share no stored identifier value.")
    return lines


def _campaign(ctx: AnalystContext) -> list[str]:
    """Potential-campaign summary over several verdicts.

    Members are linked ONLY where a member's stored /related result names another
    member (exact stored-attribute match). Nothing is grouped by similarity,
    brand or timing, and the result is never called a confirmed campaign.
    """
    members = [s for s in ctx.subjects if s.threat]
    if len(members) < 2:
        lines = _relations(ctx)
        return [
            "A campaign summary needs at least two verdicts linked by shared identifiers. "
            "Here is what the risk engine links to this one:",
            "",
        ] + lines

    by_entity = {m.threat["entity_id"]: m for m in members}
    links: dict[tuple[str, str], dict[str, Any]] = {}
    for m in members:
        for r in m.related:
            if r["same_entity"] or r["entity_id"] not in by_entity:
                continue
            key = (r["shared_attribute"]["key"], r["shared_attribute"]["value"])
            link = links.setdefault(key, {"entities": set(), "evidence": []})
            link["entities"].update({m.threat["entity_id"], r["entity_id"]})
            link["evidence"] += r["target_evidence_ids"] + r["evidence_ids"]

    linked = set().union(*(l["entities"] for l in links.values())) if links else set()
    top = max(members, key=lambda m: m.threat["risk_score"])
    brands = sorted({m.brand["name"] for m in members if m.brand})
    classes = sorted({_human(m.threat["classification"]) for m in members})

    lines = [
        f"Potential campaign: {len(members)} verdicts reviewed. "
        "This is a candidate grouping for review, not a confirmed campaign; campaign "
        "detection is not implemented in the risk engine.",
        "",
        "Members:",
    ]
    for m in members:
        lines.append(f"- {_verdict_line(m)}")
    lines += ["", "Why they are grouped (exact shared identifiers recorded by the risk engine):"]
    if links:
        for (key, value), link in links.items():
            names = ", ".join(
                f"{_name(by_entity[e])} [entity:{e}]" for e in sorted(link["entities"]) if e in by_entity
            )
            lines.append(f"- {key} \"{value}\" is shared by {names}. {_cite_all(link['evidence'])}".rstrip())
    else:
        lines.append("- None. These verdicts share no stored identifier, so the risk engine does not link them.")
    unlinked = [m for m in members if m.threat["entity_id"] not in linked]
    if links and unlinked:
        lines.append(
            "- Not linked to any other member: "
            + ", ".join(f"{_name(m)} [threat:{m.threat['threat_id']}]" for m in unlinked)
            + "."
        )
    lines += [
        "",
        f"Highest risk in the group: {_name(top)} [threat:{top.threat['threat_id']}], "
        f"{top.threat['risk_level']} ({top.threat['risk_score']}/100).",
        f"Classifications present: {', '.join(classes)}.",
        f"Protected brands targeted: {', '.join(brands) if brands else 'brand references unavailable'}.",
        "",
        "To confirm or rule out a campaign, verify the shared identifiers independently "
        "(registration, hosting and account ownership) and review each member's evidence.",
    ]
    return lines


def _summary(ctx: AnalystContext) -> list[str]:
    s = ctx.subjects[0]
    lines: list[str] = []
    if s.threat:
        lines.append(_verdict_line(s))
        top = s.threat["factors"][:2]
        if top:
            lines.append(
                "Main drivers: "
                + "; ".join(
                    f"{f['label']} ({f['points_contributed']} points) {_cite_all(f['evidence_ids'], 2)}".strip()
                    for f in top
                )
                + "."
            )
    else:
        lines.append(f"{_name(s)} has no risk-engine verdict yet.")
    lines.append(f"Stored evidence items: {len(s.evidence)}.")
    distinct = [r for r in s.related if not r["same_entity"]]
    lines.append(
        f"Entities linked by a shared identifier: {len(distinct)}."
        if s.threat
        else "Relations are only computed after a verdict exists."
    )
    return lines


_BUILDERS = {
    "campaign": _campaign,
    "why": _why,
    "evidence": _evidence,
    "relations": _relations,
    "next_steps": _next_steps,
    "compare": _compare,
    "summary": _summary,
}


def template_answer(ctx: AnalystContext, intent: str) -> str:
    lines = _BUILDERS.get(intent, _summary)(ctx)
    if ctx.missing:
        lines += ["", "Not available to this answer:"] + [f"- {m}" for m in ctx.missing[:6]]
    return "\n".join(lines).strip()
