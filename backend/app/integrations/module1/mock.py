"""MOCK Module 1 adapter — in-memory Brand DNA for tests and local dev.

SYNTHETIC TEST/LDEV DATA ONLY. Never used in production deployments:
the app binds the real HTTPBrandDNAClient when module1_base_url is set.
"""
from __future__ import annotations

from app.core.errors import MissingBrandDNAError
from app.schemas.brand_dna import BrandDNA


class MockBrandDNAClient:
    def __init__(self, dna_by_brand_id: dict[str, BrandDNA] | None = None) -> None:
        self._dna: dict[str, BrandDNA] = dict(dna_by_brand_id or {})

    def register(self, dna: BrandDNA) -> None:
        self._dna[str(dna.brand_id)] = dna

    def get_brand_dna(self, brand_id: str) -> BrandDNA:
        dna = self._dna.get(brand_id)
        if dna is None:
            raise MissingBrandDNAError(brand_id)
        return dna
