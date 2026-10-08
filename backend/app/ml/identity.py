"""Baseline identity similarity: token Jaccard blended with Levenshtein ratio.

Deterministic and dependency-free. Handles exact short handles sensibly
(edit distance dominates) while tolerating word-order and punctuation noise
in longer names (token overlap dominates).
"""
from __future__ import annotations

import re

_TOKEN_SPLIT = re.compile(r"[\s._\-@]+")


def _tokens(value: str) -> set[str]:
    return {t for t in _TOKEN_SPLIT.split(value.strip().lower()) if t}


def _levenshtein_ratio(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current = [i]
        for j, char_b in enumerate(b, start=1):
            cost = 0 if char_a == char_b else 1
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + cost))
        previous = current
    distance = previous[-1]
    return 1.0 - distance / max(len(a), len(b))


class TokenIdentitySimilarity:
    name = "token_similarity"
    version = "1.0.0"

    def similarity(self, reference: str, candidate: str) -> float:
        ref_clean = reference.strip().lower()
        cand_clean = candidate.strip().lower()
        if not ref_clean or not cand_clean:
            return 0.0
        edit_score = _levenshtein_ratio(ref_clean, cand_clean)
        ref_tokens, cand_tokens = _tokens(ref_clean), _tokens(cand_clean)
        if ref_tokens and cand_tokens:
            jaccard = len(ref_tokens & cand_tokens) / len(ref_tokens | cand_tokens)
        else:
            jaccard = 0.0
        return max(0.0, min(1.0, 0.5 * edit_score + 0.5 * jaccard))
