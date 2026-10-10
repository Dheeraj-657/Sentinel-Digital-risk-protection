"""MOCK Module 3 adapters — in-memory entity/evidence for tests and local dev.

SYNTHETIC TEST/DEV DATA ONLY. Evidence items are keyed by entity_id; tenant
isolation for evidence access is enforced via EntityProvider (an evidence
list is only reachable for an entity the tenant can see), matching the
boundary contract the real Module 3 must honor.
"""
from __future__ import annotations

from app.core.errors import InvalidEntityError
from app.schemas.entity import EntityReference, EvidenceReference


class MockEntityProvider:
    def __init__(self, entities: list[EntityReference] | None = None) -> None:
        self._entities: dict[str, EntityReference] = {
            str(e.entity_id): e for e in (entities or [])
        }

    def register(self, entity: EntityReference) -> None:
        self._entities[str(entity.entity_id)] = entity

    def get_entity(self, tenant_id: str, entity_id: str) -> EntityReference:
        entity = self._entities.get(entity_id)
        if entity is None or str(entity.tenant_id) != tenant_id:
            raise InvalidEntityError(entity_id)
        return entity


class MockEvidenceProvider:
    def __init__(self, evidence: list[EvidenceReference] | None = None) -> None:
        self._by_entity: dict[str, list[EvidenceReference]] = {}
        for item in evidence or []:
            self.add(item)

    def add(self, evidence: EvidenceReference) -> None:
        self._by_entity.setdefault(str(evidence.entity_id), []).append(evidence)

    def list_evidence(self, tenant_id: str, entity_id: str) -> list[EvidenceReference]:
        return list(self._by_entity.get(entity_id, []))
