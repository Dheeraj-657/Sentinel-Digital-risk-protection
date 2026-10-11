"""Evidence retrieval and minimum-evidence gating (Module 3 boundary)."""
from __future__ import annotations

from app.core.errors import InsufficientEvidenceError
from app.integrations.module3 import EvidenceProvider
from app.risk.config import RiskEngineConfig
from app.schemas.entity import EvidenceReference


class EvidenceService:
    def __init__(self, provider: EvidenceProvider, config: RiskEngineConfig) -> None:
        self._provider = provider
        self._config = config

    def collect(self, tenant_id: str, entity_id: str) -> list[EvidenceReference]:
        """Fetch evidence and enforce the configured minimum.

        No evidence means no analysis: an unexplained score is worse than no
        score, so we fail fast with a typed error.
        """
        evidence = self._provider.list_evidence(tenant_id, entity_id)
        if len(evidence) < self._config.minimum_total_evidence:
            raise InsufficientEvidenceError(
                evidence_count=len(evidence),
                minimum=self._config.minimum_total_evidence,
            )
        return evidence

    @staticmethod
    def used_evidence_ids(factors: list) -> dict[str, set]:
        """Map evidence_id → set of factor types citing it (for references)."""
        from app.domain.enums import FactorType

        usage: dict[str, set[FactorType]] = {}
        for factor in factors:
            for evidence_id in factor.evidence_ids:
                usage.setdefault(evidence_id, set()).add(factor.factor_type)
        return usage
