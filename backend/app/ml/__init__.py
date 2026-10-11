"""ML model interfaces, baseline implementations, and registry."""
from app.ml.registry import ModelSet, build_model_set
from app.ml.text import CharNGramTextSimilarity, SklearnTFIDFTextSimilarity
from app.ml.visual import PhashHammingVisualSimilarity

__all__ = [
    "CharNGramTextSimilarity",
    "ModelSet",
    "PhashHammingVisualSimilarity",
    "SklearnTFIDFTextSimilarity",
    "build_model_set",
]
