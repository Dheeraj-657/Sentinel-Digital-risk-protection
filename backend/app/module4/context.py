"""Grounded context assembly for the AI Security Analyst.

Everything the analyst may say comes from here, and everything here comes
from an existing source of truth:

  * threats + risk factors  — Module 2's own threat register (read-only)
  * related threats         — Module 2's RelatedThreatService (unchanged)
  * entities + evidence     — Module 3 via the configured adapter
  * Brand DNA               — Module 1 via the configured brand client

Nothing is scored, inferred or fetched from the open internet. Gaps are
recorded in `missing` so the answer can disclose them.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.domain.enums import FactorType
from app.models.threat import Threat
from app.services.relations import RelatedThreatService
from app.services.threat_service import ThreatService

MAX_EVIDENCE_PER_ENTITY = 25
MAX_TEXT_CHARS = 280
MAX_THREATS_PER_ENTITY = 6

FACTOR_LABELS = {
    FactorType.IDENTITY_SIMILARITY.value: "identity similarity",
    FactorType.TEXT_SIMILARITY.value: "text similarity",
    FactorType.VISUAL_SIMILARITY.value: "visual similarity",
    FactorType.DOMAIN_SIGNALS.value: "domain signals",
    FactorType.BEHAVIORAL_SIGNALS.value: "behavioral signals",
    FactorType.REPUTATION_SIGNALS.value: "reputation signals",
    FactorType.RELATIONSHIP_SIGNALS.value: "relationship signals",
}


class _MemoProvider:
    """Per-request memoizing proxy over the Module 3 adapters.

    RelatedThreatService resolves the same entities repeatedly; caching the
    responses for one request changes no result, only avoids duplicate HTTP
    calls. Exceptions are cached too, so a failing entity fails consistently.
    """

    def __init__(self, entity_provider, evidence_provider) -> None:
        self._entities = entity_provider
        self._evidence = evidence_provider
        self._entity_cache: dict[tuple[str, str], Any] = {}
        self._evidence_cache: dict[tuple[str, str], Any] = {}

    def get_entity(self, tenant_id: str, entity_id: str):
        key = (tenant_id, entity_id)
        if key not in self._entity_cache:
            try:
                self._entity_cache[key] = self._entities.get_entity(tenant_id, entity_id)
            except Exception as exc:  # noqa: BLE001 — re-raised below, consistently
                self._entity_cache[key] = exc
        value = self._entity_cache[key]
        if isinstance(value, Exception):
            raise value
        return value

    def list_evidence(self, tenant_id: str, entity_id: str):
        key = (tenant_id, entity_id)
        if key not in self._evidence_cache:
            try:
                self._evidence_cache[key] = self._evidence.list_evidence(tenant_id, entity_id)
            except Exception as exc:  # noqa: BLE001
                self._evidence_cache[key] = exc
        value = self._evidence_cache[key]
        if isinstance(value, Exception):
            raise value
        return value


@dataclass
class Subject:
    """One threat (verdict) or a bare entity with no verdict yet."""

    entity: dict[str, Any] | None
    threat: dict[str, Any] | None = None
    evidence: list[dict[str, Any]] = field(default_factory=list)
    related: list[dict[str, Any]] = field(default_factory=list)
    brand: dict[str, Any] | None = None
    other_threats: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class AnalystContext:
    subjects: list[Subject]
    missing: list[str]

    # ---- registries used by the grounding guard ----
    @property
    def evidence_ids(self) -> set[str]:
        ids: set[str] = set()
        for s in self.subjects:
            ids.update(e["evidence_id"] for e in s.evidence)
            if s.threat:
                for f in s.threat["factors"]:
                    ids.update(f["evidence_ids"])
            for r in s.related:
                ids.update(r["evidence_ids"])
                ids.update(r["target_evidence_ids"])
        return ids

    @property
    def threat_ids(self) -> set[str]:
        ids: set[str] = set()
        for s in self.subjects:
            if s.threat:
                ids.add(s.threat["threat_id"])
            ids.update(r["threat_id"] for r in s.related)
            ids.update(t["threat_id"] for t in s.other_threats)
        return ids

    @property
    def entity_ids(self) -> set[str]:
        ids: set[str] = set()
        for s in self.subjects:
            if s.entity:
                ids.add(s.entity["entity_id"])
            ids.update(r["entity_id"] for r in s.related)
        return ids

    @property
    def risk_scores(self) -> set[int]:
        scores = {s.threat["risk_score"] for s in self.subjects if s.threat}
        for s in self.subjects:
            scores.update(t["risk_score"] for t in s.other_threats)
        return scores

    @property
    def risk_levels(self) -> set[str]:
        levels = {s.threat["risk_level"] for s in self.subjects if s.threat}
        for s in self.subjects:
            levels.update(t["risk_level"] for t in s.other_threats)
        return levels

    def to_prompt_payload(self) -> dict[str, Any]:
        return {
            "subjects": [
                {
                    "entity": s.entity,
                    "verdict": s.threat,
                    "protected_brand": s.brand,
                    "evidence": s.evidence,
                    "related_threats": s.related,
                    "other_verdicts_for_same_entity": s.other_threats,
                }
                for s in self.subjects
            ],
            "unavailable_or_missing": self.missing,
        }

    def corpus(self) -> str:
        """Every literal the answer may legitimately repeat (numbers check)."""
        return json.dumps(self.to_prompt_payload(), default=str)


def _pct(value: float) -> int:
    return int(round(value * 100))


def _threat_dict(threat: Threat) -> dict[str, Any]:
    factors = sorted(threat.risk_factors, key=lambda f: f.contribution, reverse=True)
    present = {f.factor_type.value for f in factors}
    return {
        "threat_id": str(threat.id),
        "brand_id": str(threat.brand_id),
        "entity_id": str(threat.entity_id),
        "risk_score": int(threat.risk_score),
        "risk_level": threat.risk_level.value,
        "classification": threat.classification.value,
        "confidence_percent": _pct(threat.confidence),
        "status": threat.status.value,
        "analysis_timestamp": threat.analysis_timestamp.isoformat(),
        "risk_engine_version": threat.risk_engine_version,
        "factors": [
            {
                "factor_type": f.factor_type.value,
                "label": FACTOR_LABELS.get(f.factor_type.value, f.factor_type.value),
                "score": int(f.score),
                "weight_percent": _pct(f.weight),
                "points_contributed": round(float(f.contribution), 1),
                "confidence_percent": _pct(f.confidence),
                "basis": f.basis.value,
                "evidence_ids": [str(e) for e in (f.evidence_ids or [])],
            }
            for f in factors
        ],
        "factor_families_without_signal": [
            FACTOR_LABELS[k] for k in FACTOR_LABELS if k not in present
        ],
    }


def _threat_summary(threat: Threat) -> dict[str, Any]:
    return {
        "threat_id": str(threat.id),
        "brand_id": str(threat.brand_id),
        "risk_score": int(threat.risk_score),
        "risk_level": threat.risk_level.value,
        "classification": threat.classification.value,
        "status": threat.status.value,
    }


def _entity_dict(entity) -> dict[str, Any]:
    return {
        "entity_id": str(entity.entity_id),
        "entity_type": entity.entity_type.value if hasattr(entity.entity_type, "value") else str(entity.entity_type),
        "display_name": entity.display_name,
        "identifiers": dict(entity.identifiers or {}),
    }


def _evidence_dict(item) -> dict[str, Any]:
    text = item.text or None
    if text and len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS] + "…"
    metadata = item.metadata or {}
    # Keep metadata compact and JSON-safe; values are untrusted collected data.
    compact = {str(k)[:60]: (v if isinstance(v, (bool, int, float)) else str(v)[:120]) for k, v in list(metadata.items())[:10]}
    return {
        "evidence_id": str(item.evidence_id),
        "source_id": str(item.source_id),
        "evidence_type": item.evidence_type.value if hasattr(item.evidence_type, "value") else str(item.evidence_type),
        "collected_at": item.collected_at.isoformat() if item.collected_at else None,
        "url": item.url,
        "text": text,
        "image_hash": item.image_hash,
        "metadata": compact,
    }


def _brand_dict(brand_client, brand_id: str, missing: list[str]) -> dict[str, Any] | None:
    try:
        dna = brand_client.get_brand_dna(brand_id)
    except Exception:  # noqa: BLE001 — honest gap, never a guess
        missing.append(f"Brand DNA for brand '{brand_id}' could not be retrieved from Module 1.")
        return None
    return {
        "brand_id": str(dna.brand_id),
        "name": dna.identity.name,
        "official_domains": [d.domain for d in dna.domains],
        "verified_social_handles": list(dna.verification.verified_social_handles),
    }


class ContextBuilder:
    def __init__(self, db: Session, tenant_id: uuid.UUID, state) -> None:
        self._db = db
        self._tenant = tenant_id
        self._tenant_str = str(tenant_id)
        self._providers = _MemoProvider(state.entity_provider, state.evidence_provider)
        self._brand_client = state.brand_client
        self._brand_cache: dict[str, dict[str, Any] | None] = {}

    # ---------------------------------------------------------------- public

    def build(
        self,
        *,
        threat_id: uuid.UUID | None,
        entity_id: uuid.UUID | None,
        compare_threat_id: uuid.UUID | None,
    ) -> AnalystContext:
        missing: list[str] = []
        subjects: list[Subject] = []

        if threat_id is not None:
            threat = self._get_threat(threat_id)
            if entity_id is not None and threat.entity_id != entity_id:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    "threat_id does not belong to entity_id.",
                    http_status=422,
                    details={"threat_id": str(threat_id), "entity_id": str(entity_id)},
                )
            subjects.append(self._subject_for_threat(threat, missing))
        else:
            assert entity_id is not None
            subjects.append(self._subject_for_entity(entity_id, missing))

        if compare_threat_id is not None:
            if threat_id is not None and compare_threat_id == threat_id:
                missing.append("The comparison threat is the same as the subject threat.")
            else:
                subjects.append(self._subject_for_threat(self._get_threat(compare_threat_id), missing))

        return AnalystContext(subjects=subjects, missing=missing)

    # --------------------------------------------------------------- helpers

    def _get_threat(self, threat_id: uuid.UUID) -> Threat:
        threat = ThreatService(self._db).get_for_tenant(self._tenant, threat_id)
        if threat is None:
            # Missing vs cross-tenant are indistinguishable (Module 2 policy).
            raise AppError(
                ErrorCode.NOT_FOUND,
                f"Threat '{threat_id}' was not found.",
                http_status=404,
                details={"threat_id": str(threat_id)},
            )
        return threat

    def _brand(self, brand_id: str, missing: list[str]) -> dict[str, Any] | None:
        if brand_id not in self._brand_cache:
            self._brand_cache[brand_id] = _brand_dict(self._brand_client, brand_id, missing)
        return self._brand_cache[brand_id]

    def _entity(self, entity_id: str, missing: list[str]) -> dict[str, Any] | None:
        try:
            return _entity_dict(self._providers.get_entity(self._tenant_str, entity_id))
        except AppError as exc:
            if exc.code == ErrorCode.INVALID_ENTITY:
                missing.append(f"Entity '{entity_id}' is not present in the evidence store (Module 3).")
            else:
                missing.append(f"Entity '{entity_id}' could not be retrieved: Module 3 unavailable.")
        except Exception:  # noqa: BLE001
            missing.append(f"Entity '{entity_id}' could not be retrieved: Module 3 unavailable.")
        return None

    def _evidence(self, entity_id: str, missing: list[str]) -> list[dict[str, Any]]:
        try:
            items = self._providers.list_evidence(self._tenant_str, entity_id)
        except Exception:  # noqa: BLE001
            missing.append(f"Evidence for entity '{entity_id}' could not be retrieved from Module 3.")
            return []
        if not items:
            missing.append(f"No evidence items are stored for entity '{entity_id}'.")
        if len(items) > MAX_EVIDENCE_PER_ENTITY:
            missing.append(
                f"Only the first {MAX_EVIDENCE_PER_ENTITY} of {len(items)} evidence items were provided to the analyst."
            )
        return [_evidence_dict(i) for i in items[:MAX_EVIDENCE_PER_ENTITY]]

    def _related(self, threat: Threat, missing: list[str]) -> list[dict[str, Any]]:
        service = RelatedThreatService(self._db, self._providers, self._providers)
        _, relations, warnings = service.find_related(self._tenant, threat.id)
        missing.extend(warnings)
        return [
            {
                "threat_id": str(r["threat_id"]),
                "entity_id": str(r["entity_id"]),
                "entity_display_name": r["entity_display_name"],
                "relation_type": r["relation_type"],
                "basis": r["basis"],
                "shared_attribute": r["shared_attribute"],
                "evidence_ids": [str(e) for e in r["evidence_ids"]],
                "target_evidence_ids": [str(e) for e in r["target_evidence_ids"]],
                "same_entity": r["entity_id"] == threat.entity_id,
            }
            for r in relations
        ]

    def _other_threats(self, entity_id: uuid.UUID, exclude: uuid.UUID | None) -> list[dict[str, Any]]:
        rows = self._db.scalars(
            select(Threat)
            .where(Threat.tenant_id == self._tenant, Threat.entity_id == entity_id)
            .order_by(Threat.risk_score.desc(), Threat.analysis_timestamp.desc())
            .limit(MAX_THREATS_PER_ENTITY + 1)
        ).all()
        return [_threat_summary(t) for t in rows if t.id != exclude][:MAX_THREATS_PER_ENTITY]

    def _subject_for_threat(self, threat: Threat, missing: list[str]) -> Subject:
        entity_id = str(threat.entity_id)
        return Subject(
            entity=self._entity(entity_id, missing),
            threat=_threat_dict(threat),
            evidence=self._evidence(entity_id, missing),
            related=self._related(threat, missing),
            brand=self._brand(str(threat.brand_id), missing),
            other_threats=self._other_threats(threat.entity_id, threat.id),
        )

    def _subject_for_entity(self, entity_id: uuid.UUID, missing: list[str]) -> Subject:
        threats = self._db.scalars(
            select(Threat)
            .where(Threat.tenant_id == self._tenant, Threat.entity_id == entity_id)
            .order_by(Threat.risk_score.desc(), Threat.analysis_timestamp.desc())
            .limit(1)
        ).all()
        if threats:
            return self._subject_for_threat(threats[0], missing)

        entity = self._entity(str(entity_id), missing)
        if entity is None:
            raise AppError(
                ErrorCode.NOT_FOUND,
                f"Entity '{entity_id}' was not found.",
                http_status=404,
                details={"entity_id": str(entity_id)},
            )
        missing.append(
            "The risk engine has not produced a verdict for this entity yet; no risk score, "
            "factors or related threats exist. Run an analysis to obtain them."
        )
        return Subject(entity=entity, evidence=self._evidence(str(entity_id), missing))
