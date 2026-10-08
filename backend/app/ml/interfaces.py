"""Replaceable ML model interfaces.

Feature extraction, model inference, and risk calculation are separate
layers: models return normalized similarity in [0.0, 1.0] and nothing else.
No API route and no risk rule may call an ML library directly — everything
goes through these protocols via the registry.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class TextSimilarityModel(Protocol):
    """Compare two texts; 1.0 = identical, 0.0 = unrelated."""

    name: str
    version: str

    def similarity(self, reference: str, candidate: str) -> float: ...


@runtime_checkable
class VisualSimilarityModel(Protocol):
    """Compare two perceptual image hashes (hex); 1.0 = identical."""

    name: str
    version: str

    def similarity(self, reference_hash: str, candidate_hash: str) -> float: ...


@runtime_checkable
class IdentitySimilarityModel(Protocol):
    """Compare two identity strings (brand name/handle vs entity handle/name)."""

    name: str
    version: str

    def similarity(self, reference: str, candidate: str) -> float: ...
