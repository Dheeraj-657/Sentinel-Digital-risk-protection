"""Baseline text similarity: character n-gram cosine, pure Python.

Deterministic, dependency-free, suitable as the default model. The optional
scikit-learn TF-IDF adapter lives here too (model name "sklearn_tfidf") —
it is selected only when scikit-learn is installed; sentence-transformers
remains an EXTERNAL_DEPENDENCY proposal, deliberately not bundled.
"""
from __future__ import annotations

import math
from collections import Counter

NGRAM_SIZE = 3


def _char_ngrams(text: str, n: int = NGRAM_SIZE) -> Counter[str]:
    normalized = " ".join(text.lower().split())
    if len(normalized) < n:
        return Counter([normalized]) if normalized else Counter()
    return Counter(normalized[i : i + n] for i in range(len(normalized) - n + 1))


def _cosine(a: Counter[str], b: Counter[str]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(count * b.get(gram, 0) for gram, count in a.items())
    if dot == 0:
        return 0.0
    norm_a = math.sqrt(sum(c * c for c in a.values()))
    norm_b = math.sqrt(sum(c * c for c in b.values()))
    return dot / (norm_a * norm_b)


class CharNGramTextSimilarity:
    name = "char_ngram_tfidf"
    version = "1.0.0"

    def similarity(self, reference: str, candidate: str) -> float:
        score = _cosine(_char_ngrams(reference), _char_ngrams(candidate))
        return max(0.0, min(1.0, score))


class SklearnTFIDFTextSimilarity:
    """Optional adapter. Same contract, different backend — proving models are
    replaceable without touching pipeline or risk code."""

    name = "sklearn_tfidf"
    version = "1.0.0"

    def __init__(self) -> None:
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.metrics.pairwise import cosine_similarity
        except ImportError as exc:
            raise RuntimeError(
                "scikit-learn is not installed; install backend[ml] to use sklearn_tfidf"
            ) from exc
        self._vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
        self._cosine = cosine_similarity

    def similarity(self, reference: str, candidate: str) -> float:
        if not reference.strip() or not candidate.strip():
            return 0.0
        matrix = self._vectorizer.fit_transform([reference, candidate])
        score = float(self._cosine(matrix[0], matrix[1])[0][0])
        return max(0.0, min(1.0, score))
