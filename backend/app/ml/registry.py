"""Model registry: builds the active model set from settings.

Selection is configuration-driven (TRUSTGRAPH_*_MODEL env vars); unknown
names raise ModelUnavailableError at startup wiring time, never mid-analysis.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings
from app.core.errors import ModelUnavailableError
from app.ml.identity import TokenIdentitySimilarity
from app.ml.interfaces import (
    IdentitySimilarityModel,
    TextSimilarityModel,
    VisualSimilarityModel,
)
from app.ml.text import CharNGramTextSimilarity, SklearnTFIDFTextSimilarity
from app.ml.visual import PhashHammingVisualSimilarity

TEXT_MODELS = {"char_ngram_tfidf": CharNGramTextSimilarity, "sklearn_tfidf": SklearnTFIDFTextSimilarity}
VISUAL_MODELS = {"phash_hamming": PhashHammingVisualSimilarity}
IDENTITY_MODELS = {"token_similarity": TokenIdentitySimilarity}


@dataclass(frozen=True)
class ModelSet:
    text: TextSimilarityModel
    visual: VisualSimilarityModel
    identity: IdentitySimilarityModel

    @property
    def version_string(self) -> str:
        """Composite model version persisted on Threat/AnalysisResult.

        major.minor per model keeps the composite within the 64-char column;
        patch-level changes do not alter scoring semantics.
        """
        parts = []
        for model in (self.text, self.visual, self.identity):
            short_version = model.version.rsplit(".", 1)[0]
            parts.append(f"{model.name}@{short_version}")
        return "+".join(parts)


def _build(kind: str, name: str, catalog: dict) -> object:
    factory = catalog.get(name)
    if factory is None:
        raise ModelUnavailableError(
            model_name=name, reason=f"unknown {kind} model; available: {sorted(catalog)}"
        )
    try:
        return factory()
    except RuntimeError as exc:
        raise ModelUnavailableError(model_name=name, reason=str(exc)) from exc


def build_model_set(settings: Settings) -> ModelSet:
    return ModelSet(
        text=_build("text", settings.text_model, TEXT_MODELS),  # type: ignore[arg-type]
        visual=_build("visual", settings.visual_model, VISUAL_MODELS),  # type: ignore[arg-type]
        identity=_build("identity", settings.identity_model, IDENTITY_MODELS),  # type: ignore[arg-type]
    )
