"""Feature extraction: evidence → factor candidates.

Extraction is separate from inference (model calls happen only for
identity/text/visual in similarity_service) and from risk calculation.
Rules are deterministic and documented; a factor candidate is produced
ONLY when supporting evidence exists — no evidence, no factor.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.domain.enums import EvidenceBasis, EvidenceType, FactorType
from app.ml.registry import ModelSet
from app.risk.calculator import FactorInput
from app.schemas.brand_dna import BrandDNA
from app.schemas.entity import EntityReference, EvidenceReference
from app.services.normalization import normalize_handle, normalize_text, registrable_domain


@dataclass(frozen=True)
class FactorCandidate:
    factor_type: FactorType
    score: int
    confidence: float
    evidence_ids: tuple[str, ...]
    basis: EvidenceBasis

    def to_input(self) -> FactorInput:
        return FactorInput(
            factor_type=self.factor_type,
            score=self.score,
            confidence=self.confidence,
            evidence_ids=self.evidence_ids,
            basis=self.basis,
        )


def _clamp(value: float, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, int(value + 0.5)))


def _entity_identity_strings(entity: EntityReference) -> list[str]:
    strings = []
    if entity.display_name:
        strings.append(normalize_text(entity.display_name))
    for key in ("handle", "username", "screen_name", "name"):
        if key in entity.identifiers:
            strings.append(normalize_handle(entity.identifiers[key]))
    return [s for s in strings if s]


def _brand_identity_strings(dna: BrandDNA) -> list[str]:
    strings = [normalize_text(dna.identity.name)]
    strings.extend(normalize_text(alias) for alias in dna.identity.aliases)
    strings.append(normalize_handle(dna.identity.name))
    return [s for s in strings if s]


class SignalExtractor:
    def __init__(self, models: ModelSet) -> None:
        self._models = models

    # ---- identity -------------------------------------------------------
    def identity_factor(
        self, entity: EntityReference, dna: BrandDNA, evidence: list[EvidenceReference]
    ) -> FactorCandidate | None:
        if not evidence:
            return None
        candidates = _entity_identity_strings(entity)
        references = _brand_identity_strings(dna)
        if not candidates or not references:
            return None
        best = max(
            self._models.identity.similarity(ref, cand)
            for ref in references
            for cand in candidates
        )
        # Identity similarity is DERIVED: computed from observed identifiers.
        return FactorCandidate(
            factor_type=FactorType.IDENTITY_SIMILARITY,
            score=_clamp(best * 100),
            confidence=best,
            evidence_ids=tuple(str(e.evidence_id) for e in evidence),
            basis=EvidenceBasis.DERIVED,
        )

    # ---- text -----------------------------------------------------------
    def text_factor(
        self, entity: EntityReference, dna: BrandDNA, evidence: list[EvidenceReference]
    ) -> FactorCandidate | None:
        text_evidence = [e for e in evidence if e.text]
        if not text_evidence:
            return None
        references = [normalize_text(dna.identity.name)]
        references.extend(normalize_text(s.text) for s in dna.text_signals)
        references = [r for r in references if r]
        if not references:
            return None
        best = 0.0
        for item in text_evidence:
            candidate = normalize_text(item.text)
            if not candidate:
                continue
            score = max(self._models.text.similarity(ref, candidate) for ref in references)
            best = max(best, score)
        if best <= 0.0:
            return None
        used = [e for e in text_evidence if self._best_text_score(e, references) == best]
        return FactorCandidate(
            factor_type=FactorType.TEXT_SIMILARITY,
            score=_clamp(best * 100),
            confidence=best,
            evidence_ids=tuple(str(e.evidence_id) for e in (used or text_evidence)),
            basis=EvidenceBasis.DERIVED,
        )

    def _best_text_score(self, item: EvidenceReference, references: list[str]) -> float:
        candidate = normalize_text(item.text)
        if not candidate:
            return 0.0
        return max(self._models.text.similarity(ref, candidate) for ref in references)

    # ---- visual ---------------------------------------------------------
    def visual_factor(
        self, entity: EntityReference, dna: BrandDNA, evidence: list[EvidenceReference]
    ) -> FactorCandidate | None:
        if not dna.visual_assets:
            return None
        reference_hashes = [
            asset.content_hash for asset in dna.visual_assets if asset.content_hash
        ]
        if not reference_hashes:
            return None
        image_evidence = [e for e in evidence if e.image_hash]
        if not image_evidence:
            return None
        scored: list[tuple[float, EvidenceReference]] = [
            (max(self._models.visual.similarity(rh, e.image_hash) for rh in reference_hashes), e)
            for e in image_evidence
        ]
        best_score, best_evidence = max(scored, key=lambda pair: pair[0])
        if best_score <= 0.0:
            return None
        supporting = [e for score, e in scored if score == best_score]
        return FactorCandidate(
            factor_type=FactorType.VISUAL_SIMILARITY,
            score=_clamp(best_score * 100),
            confidence=best_score,
            evidence_ids=tuple(str(e.evidence_id) for e in supporting),
            basis=EvidenceBasis.DERIVED,
        )

    # ---- domain ---------------------------------------------------------
    def domain_factor(
        self, entity: EntityReference, dna: BrandDNA, evidence: list[EvidenceReference]
    ) -> FactorCandidate | None:
        entity_domain = registrable_domain(entity.identifiers.get("domain") or entity.identifiers.get("url") or "")
        brand_domains = {registrable_domain(d.domain) for d in dna.domains}
        verified = {registrable_domain(v) for v in dna.verification.verified_domains}

        supporting = [e for e in evidence if e.evidence_type == EvidenceType.DOMAIN_INTEL or e.url]
        if not entity_domain and not supporting:
            return None

        score = 0.0
        contributions: list[str] = []

        if entity_domain and entity_domain not in verified:
            best_similarity = max(
                (
                    self._models.text.similarity(bd, entity_domain)
                    for bd in brand_domains
                    if bd
                ),
                default=0.0,
            )
            # Similarity to an official domain only counts when it is NOT the
            # official domain itself (a legitimate mirror is not a threat by
            # this factor alone).
            if best_similarity > 0.4:
                score += 35 + best_similarity * 45
                contributions.append("domain_similarity")
        elif entity_domain in verified:
            return None

        for item in supporting:
            meta = item.metadata
            if meta.get("days_since_registration") is not None:
                days = int(meta["days_since_registration"])
                if days <= 60:
                    score += 25
                    contributions.append("recent_registration")
            if meta.get("whois_privacy"):
                score += 10
                contributions.append("whois_privacy")

        if not contributions:
            return None
        confidence = min(1.0, 0.55 + 0.15 * len(contributions))
        return FactorCandidate(
            factor_type=FactorType.DOMAIN_SIGNALS,
            score=_clamp(score),
            confidence=confidence,
            evidence_ids=tuple(str(e.evidence_id) for e in supporting) or (),
            basis=EvidenceBasis.INFERRED,
        )

    # ---- behavioral -----------------------------------------------------
    def behavioral_factor(
        self, entity: EntityReference, dna: BrandDNA, evidence: list[EvidenceReference]
    ) -> FactorCandidate | None:
        behavioral = [e for e in evidence if e.evidence_type == EvidenceType.BEHAVIORAL_EVENT]
        if not behavioral:
            return None
        score = 0.0
        flags: list[str] = []
        for item in behavioral:
            meta = item.metadata
            if meta.get("recent_account_creation"):
                score += 40
                flags.append("recent_account_creation")
            if meta.get("high_post_frequency"):
                score += 25
                flags.append("high_post_frequency")
            if meta.get("brand_mimicry_in_bio"):
                score += 35
                flags.append("brand_mimicry_in_bio")
        if not flags:
            return None
        return FactorCandidate(
            factor_type=FactorType.BEHAVIORAL_SIGNALS,
            score=_clamp(score),
            confidence=min(1.0, 0.6 + 0.1 * len(behavioral)),
            evidence_ids=tuple(str(e.evidence_id) for e in behavioral),
            basis=EvidenceBasis.OBSERVED,
        )

    # ---- reputation -----------------------------------------------------
    def reputation_factor(
        self, entity: EntityReference, dna: BrandDNA, evidence: list[EvidenceReference]
    ) -> FactorCandidate | None:
        reputation = [e for e in evidence if e.evidence_type == EvidenceType.REPUTATION_INTEL]
        if not reputation:
            return None
        score = 0.0
        reasons: list[str] = []
        for item in reputation:
            meta = item.metadata
            if meta.get("blocklisted"):
                score = max(score, 85.0)
                reasons.append("blocklisted")
            reports = meta.get("abuse_reports")
            if reports is not None:
                score = max(score, min(100.0, 20 * int(reports)))
                reasons.append("abuse_reports")
        if not reasons:
            return None
        return FactorCandidate(
            factor_type=FactorType.REPUTATION_SIGNALS,
            score=_clamp(score),
            confidence=0.7,
            evidence_ids=tuple(str(e.evidence_id) for e in reputation),
            basis=EvidenceBasis.OBSERVED,
        )

    # ---- relationship ---------------------------------------------------
    def relationship_factor(
        self, entity: EntityReference, dna: BrandDNA, evidence: list[EvidenceReference]
    ) -> FactorCandidate | None:
        links = [e for e in evidence if e.evidence_type == EvidenceType.RELATIONSHIP_LINK]
        if not links:
            return None
        score = 0.0
        reasons: list[str] = []
        for item in links:
            meta = item.metadata
            if meta.get("linked_to_known_threat"):
                score = max(score, 70.0)
                reasons.append("linked_to_known_threat")
            shared = meta.get("shared_identifiers")
            if shared is not None and int(shared) >= 2:
                score = max(score, 60.0)
                reasons.append("shared_identifiers")
        if not reasons:
            return None
        return FactorCandidate(
            factor_type=FactorType.RELATIONSHIP_SIGNALS,
            score=_clamp(score),
            confidence=0.65,
            evidence_ids=tuple(str(e.evidence_id) for e in links),
            basis=EvidenceBasis.INFERRED,
        )
