"""Grounding guard for analyst answers.

Ports the policy of Module 1's `src/lib/ai/grounding.ts` to the analyst:

  * citations use inline tokens  [ev:<uuid>]  [threat:<uuid>]  [entity:<uuid>]
    and must reference records that are actually in the context — unknown
    ids are stripped and reported;
  * any number not present in the context is treated as invented → reject;
  * a risk level or risk score that differs from the stored verdicts → reject;
  * claims that a block / report / takedown / scan was performed → reject
    (the analyst never performs actions, so such a claim is always false);
  * when evidence exists, an answer with no valid citation → reject.

A rejected answer is replaced by the deterministic template (see fallback.py),
and the reason is surfaced to the analyst.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field

from app.module4.context import AnalystContext

UUID_RE = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
CITATION_RE = re.compile(rf"\[(ev|threat|entity):({UUID_RE})\]")
BARE_UUID_RE = re.compile(UUID_RE)
NUMBER_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")
LIST_NUMBERING_RE = re.compile(r"(?m)^\s*\d+[.)]\s")

ACTION_CLAIM_RE = re.compile(
    r"\b(?:i|we|the system|trustgraph|it)\s+(?:have|has|had)?\s*"
    r"(?:blocked|reported|taken down|took down|removed|submitted|filed|escalated|scanned|notified)\b"
    r"|\b(?:has|have|was|were)\s+(?:been\s+)?(?:successfully\s+)?"
    r"(?:blocked|reported|taken down|removed|submitted|filed|escalated)\b",
    re.IGNORECASE,
)

LEVEL_RE = re.compile(r"\b(critical|high|medium|low)[\s-]+risk\b", re.IGNORECASE)
SCORE_RE = re.compile(r"\b(?:risk\s+)?score\s+(?:of|is|was|=|at)\s+(\d{1,3})\b", re.IGNORECASE)

KIND_TO_FIELD = {"ev": "evidence_ids", "threat": "threat_ids", "entity": "entity_ids"}


@dataclass
class GroundedAnswer:
    answer: str
    citations: dict[str, list[uuid.UUID]]
    limitations: list[str]
    notes: list[str] = field(default_factory=list)


class GroundingRejected(Exception):
    """The model's output failed a grounding rule; reason is user-facing."""


def _norm_number(value: str) -> str:
    value = value.replace(",", "")
    try:
        f = float(value)
    except ValueError:
        return value
    return str(int(f)) if f.is_integer() else str(f)


def _allowed_numbers(ctx: AnalystContext) -> set[str]:
    # Digits inside UUIDs and hashes are not facts — exclude them, otherwise
    # nearly every small number would look "grounded".
    corpus = BARE_UUID_RE.sub(" ", ctx.corpus())
    corpus = re.sub(r"\b[0-9a-fA-F]{12,}\b", " ", corpus)
    allowed = {_norm_number(n) for n in NUMBER_RE.findall(corpus)}
    # Count facts the answer may state about the context itself.
    evidence_total = sum(len(s.evidence) for s in ctx.subjects)
    related_total = sum(len(s.related) for s in ctx.subjects)
    allowed.update({str(evidence_total), str(related_total), str(len(ctx.subjects)), "0", "100"})
    return allowed


def _strip_for_number_check(text: str) -> str:
    text = CITATION_RE.sub(" ", text)
    text = BARE_UUID_RE.sub(" ", text)
    return LIST_NUMBERING_RE.sub(" ", text)


# Campaign detection is not implemented, so an answer may never assert one.
CAMPAIGN_CLAIM_RE = re.compile(
    r"\bconfirmed\s+(?:\w+\s+){0,2}campaign\b"
    r"|\bcampaign\s+(?:is|was|has been|have been)\s+(?:confirmed|verified|proven|established)\b"
    r"|\b(?:is|are)\s+(?:definitely|clearly|certainly)\s+(?:part of\s+)?(?:a|the|one)\s+(?:\w+\s+)?campaign\b",
    re.I,
)
_NEGATION_RE = re.compile(r"\b(?:not|no|never|cannot|can't|isn't|aren't|unconfirmed|without)\b[^.]{0,24}$", re.I)


def _asserts_campaign(text: str) -> bool:
    for match in CAMPAIGN_CLAIM_RE.finditer(text):
        if not _NEGATION_RE.search(text[: match.start()]):
            return True
    return False


def check_text(text: str, ctx: AnalystContext, allowed: set[str]) -> None:
    """Raise GroundingRejected if a text fragment breaks a hard rule."""
    if ACTION_CLAIM_RE.search(text):
        raise GroundingRejected(
            "the answer claimed a security action was performed; the analyst cannot perform actions"
        )
    if _asserts_campaign(text):
        raise GroundingRejected(
            "the answer asserted a confirmed campaign; campaign detection is not implemented"
        )
    levels = {m.upper() for m in LEVEL_RE.findall(text)}
    unknown_levels = levels - ctx.risk_levels
    if unknown_levels:
        raise GroundingRejected(
            "the answer stated a risk level that does not match the stored verdicts "
            f"({', '.join(sorted(unknown_levels)).lower()})"
        )
    for raw in SCORE_RE.findall(text):
        if int(raw) not in ctx.risk_scores:
            raise GroundingRejected(f"the answer stated a risk score ({raw}) that no stored verdict has")
    invented = sorted(
        {n for n in NUMBER_RE.findall(_strip_for_number_check(text)) if _norm_number(n) not in allowed}
    )
    if invented:
        raise GroundingRejected(
            f"the answer contained numbers that are not in the evidence ({', '.join(invented[:5])})"
        )


def ground(raw: dict, ctx: AnalystContext) -> GroundedAnswer:
    """Validate a model payload of shape {"answer": str, "limitations": [str]}."""
    if not isinstance(raw, dict) or not isinstance(raw.get("answer"), str):
        raise GroundingRejected("the model output did not match the required JSON shape")
    answer = raw["answer"].strip()
    if len(answer) < 10:
        raise GroundingRejected("the model returned an empty answer")
    if len(answer) > 6000:
        answer = answer[:6000]

    limitations = [
        str(item).strip()[:400]
        for item in (raw.get("limitations") or [])
        if isinstance(item, (str, int, float)) and str(item).strip()
    ][:5]

    registry = {
        "evidence_ids": ctx.evidence_ids,
        "threat_ids": ctx.threat_ids,
        "entity_ids": ctx.entity_ids,
    }
    notes: list[str] = []
    citations: dict[str, list[uuid.UUID]] = {"evidence_ids": [], "threat_ids": [], "entity_ids": []}

    def replace(match: re.Match) -> str:
        kind, value = match.group(1), match.group(2).lower()
        bucket = KIND_TO_FIELD[kind]
        if value not in registry[bucket]:
            notes.append(f"Removed a citation to an unknown {kind} id.")
            return ""
        parsed = uuid.UUID(value)
        if parsed not in citations[bucket]:
            citations[bucket].append(parsed)
        return f"[{kind}:{value}]"

    answer = CITATION_RE.sub(replace, answer)
    answer = re.sub(r"[ \t]{2,}", " ", answer).strip()

    allowed = _allowed_numbers(ctx)
    check_text(answer, ctx, allowed)
    kept: list[str] = []
    for item in limitations:
        try:
            check_text(item, ctx, allowed)
            kept.append(item)
        except GroundingRejected:
            notes.append("Dropped a limitation note that failed the grounding check.")

    has_evidence = bool(ctx.evidence_ids)
    if has_evidence and not citations["evidence_ids"]:
        raise GroundingRejected("the answer cited none of the available evidence")

    return GroundedAnswer(answer=answer, citations=citations, limitations=kept, notes=notes)
