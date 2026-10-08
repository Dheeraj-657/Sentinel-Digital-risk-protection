"""Baseline visual similarity: perceptual-hash Hamming distance, pure Python.

Module 2 never fetches raw images; it compares perceptual hashes carried in
Brand DNA (visual_assets[].content_hash) and evidence (image_hash).
"""
from __future__ import annotations


def _hex_to_bits(value: str) -> list[int]:
    cleaned = value.strip().lower().replace(" ", "")
    bits: list[int] = []
    for char in cleaned:
        try:
            nibble = int(char, 16)
        except ValueError:
            continue
        bits.extend((nibble >> shift) & 1 for shift in (3, 2, 1, 0))
    return bits


class PhashHammingVisualSimilarity:
    name = "phash_hamming"
    version = "1.0.0"

    def similarity(self, reference_hash: str, candidate_hash: str) -> float:
        ref_bits = _hex_to_bits(reference_hash)
        cand_bits = _hex_to_bits(candidate_hash)
        if not ref_bits or not cand_bits:
            return 0.0
        width = max(len(ref_bits), len(cand_bits))
        ref_padded = ref_bits + [0] * (width - len(ref_bits))
        cand_padded = cand_bits + [0] * (width - len(cand_bits))
        distance = sum(1 for a, b in zip(ref_padded, cand_padded) if a != b)
        return max(0.0, min(1.0, 1.0 - distance / width))
