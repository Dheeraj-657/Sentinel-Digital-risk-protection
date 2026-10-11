"""Evidence-backed related-threat relations (P2).

A relation between two threats exists ONLY when both entities carry the
SAME stored identifier key with the EXACT same value in the same tenant
(basis: EXACT_ATTRIBUTE_MATCH). Name similarity, fuzzy domain matching and
cross-tenant comparisons are deliberately absent — an unsupported
relationship is never displayed as a fact. Evidence links are attached
only where evidence (URL host or metadata.domain) corresponds exactly to
the shared attribute's registrable domain.

Deliberately NOT delivered: a graph subsystem, relationship confidence
scores, or transitive "related via X" chains.
"""
from __future__ import annotations

import uuid
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.threat import Threat
from app.services.normalization import registrable_domain
from app.services.threat_service import ThreatService

# Hard bound so one noisy tenant cannot turn a relation lookup into a scan
# of unbounded size. Ordered deterministically below.
_MAX_CANDIDATE_THREATS = 500

RELATION_EXACT_ATTRIBUTE_MATCH = "EXACT_ATTRIBUTE_MATCH"
RELATION_SHARED_DOMAIN = "SHARED_DOMAIN"
RELATION_SHARED_IDENTIFIER = "SHARED_IDENTIFIER"


class RelatedThreatService:
    def __init__(self, session: Session, entity_provider, evidence_provider) -> None:
        self._session = session
        self._entity_provider = entity_provider
        self._evidence_provider = evidence_provider

    def find_related(
        self, tenant_id: uuid.UUID, threat_id: uuid.UUID
    ) -> tuple[Threat | None, list[dict], list[str]]:
        """Returns (threat, relations, warnings). threat is None → unknown/
        cross-tenant threat (route turns that into 404)."""
        threat = ThreatService(self._session).get_for_tenant(tenant_id, threat_id)
        if threat is None:
            return None, [], []

        warnings: list[str] = []
        try:
            target = self._entity_provider.get_entity(str(tenant_id), str(threat.entity_id))
        except Exception:
            warnings.append(
                f"Target entity '{threat.entity_id}' could not be resolved; "
                "no relations were computed."
            )
            return threat, [], warnings

        target_ids = _string_identifiers(target)
        if not target_ids:
            return threat, [], warnings

        others = self._session.scalars(
            select(Threat)
            .where(Threat.tenant_id == tenant_id, Threat.id != threat.id)
            .limit(_MAX_CANDIDATE_THREATS)
        ).all()

        relations: list[dict] = []
        for other in others:
            try:
                other_entity = self._entity_provider.get_entity(
                    str(tenant_id), str(other.entity_id)
                )
            except Exception:
                warnings.append(
                    f"Entity for threat '{other.id}' could not be resolved; skipped."
                )
                continue
            other_ids = _string_identifiers(other_entity)
            for key, value in target_ids.items():
                # Exact stored-identifier equality ONLY. No normalization,
                # no similarity, no name comparison.
                if other_ids.get(key) != value:
                    continue
                relations.append(
                    {
                        "threat_id": other.id,
                        "entity_id": other.entity_id,
                        "entity_display_name": other_entity.display_name,
                        "relation_type": (
                            RELATION_SHARED_DOMAIN if key == "domain"
                            else RELATION_SHARED_IDENTIFIER
                        ),
                        "basis": RELATION_EXACT_ATTRIBUTE_MATCH,
                        "shared_attribute": {"key": key, "value": value},
                        "evidence_ids": self._evidence_for_attribute(
                            tenant_id, other.entity_id, value
                        ),
                        "target_evidence_ids": self._evidence_for_attribute(
                            tenant_id, threat.entity_id, value
                        ),
                    }
                )

        relations.sort(
            key=lambda r: (
                r["shared_attribute"]["value"],
                r["relation_type"],
                str(r["threat_id"]),
            )
        )
        return threat, relations, warnings

    def _evidence_for_attribute(
        self, tenant_id: uuid.UUID, entity_id: uuid.UUID, value: str
    ) -> list[uuid.UUID]:
        """Evidence belonging to this entity that corresponds to the shared
        attribute value: URL host or metadata.domain resolving to the same
        registrable domain. This is a correspondence filter, not a claim
        that the evidence proves the relation."""
        expected = registrable_domain(value) or value.lower()
        matches: list[uuid.UUID] = []
        try:
            items = self._evidence_provider.list_evidence(str(tenant_id), str(entity_id))
        except Exception:
            return matches
        for item in items:
            metadata = item.metadata or {}
            meta_domain = metadata.get("domain")
            candidates = []
            if item.url:
                host = urlparse(item.url).hostname
                if host:
                    candidates.append(registrable_domain(host))
            if isinstance(meta_domain, str) and meta_domain:
                candidates.append(registrable_domain(meta_domain))
            if any(c == expected for c in candidates):
                matches.append(item.evidence_id)
        return matches


def _string_identifiers(entity) -> dict[str, str]:
    return {
        key: value
        for key, value in (entity.identifiers or {}).items()
        if isinstance(key, str) and isinstance(value, str) and value
    }
