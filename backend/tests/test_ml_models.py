"""Unit tests for the baseline ML models (SYNTHETIC TEST_ONLY inputs).

These pin the scoring contract: normalized [0.0, 1.0], deterministic, and
replaceable behind the protocols in app.ml.interfaces.
"""
from __future__ import annotations

import pytest

from app.core.config import Settings
from app.core.errors import ModelUnavailableError
from app.ml.identity import TokenIdentitySimilarity
from app.ml.interfaces import (
    IdentitySimilarityModel,
    TextSimilarityModel,
    VisualSimilarityModel,
)
from app.ml.registry import ModelSet, build_model_set
from app.ml.text import CharNGramTextSimilarity
from app.ml.visual import PhashHammingVisualSimilarity

# SYNTHETIC TEST_ONLY perceptual hashes (deliberate Hamming distances).
SAME_PHASH = "ff00aa55ff00aa55"
ONE_BIT_APART = "ff00aa55ff00aa57"
OPPOSITE_PHASH = "00ff55aa00ff55aa"


class TestCharNGramTextSimilarity:
    def test_identical_text_scores_one(self):
        model = CharNGramTextSimilarity()
        assert model.similarity("Official Acme Corp support portal",
                                "Official Acme Corp support portal") == 1.0

    def test_related_text_scores_between_zero_and_one(self):
        model = CharNGramTextSimilarity()
        score = model.similarity("Official Acme Corp support portal",
                                 "Acme Corp official support portal — verify now")
        assert 0.3 < score < 1.0

    def test_unrelated_text_scores_near_zero(self):
        model = CharNGramTextSimilarity()
        assert model.similarity("Official Acme Corp support portal", "zzz qqq xxx") < 0.3

    def test_empty_input_scores_zero(self):
        model = CharNGramTextSimilarity()
        assert model.similarity("", "anything") == 0.0
        assert model.similarity("anything", "   ") == 0.0

    def test_case_and_whitespace_insensitive(self):
        model = CharNGramTextSimilarity()
        assert model.similarity("Acme  CORP portal", "acme corp\nportal") == 1.0

    def test_always_within_unit_range(self):
        model = CharNGramTextSimilarity()
        for candidate in ("", "a", "ac", "support verify account login now"):
            score = model.similarity("Official Acme Corp support portal", candidate)
            assert 0.0 <= score <= 1.0


class TestPhashHammingVisualSimilarity:
    def test_identical_hash_scores_one(self):
        model = PhashHammingVisualSimilarity()
        assert model.similarity(SAME_PHASH, SAME_PHASH) == 1.0

    def test_one_bit_difference_is_close(self):
        model = PhashHammingVisualSimilarity()
        score = model.similarity(SAME_PHASH, ONE_BIT_APART)
        assert 0.95 < score < 1.0

    def test_opposite_hash_scores_zero(self):
        model = PhashHammingVisualSimilarity()
        assert model.similarity(SAME_PHASH, OPPOSITE_PHASH) == 0.0

    def test_invalid_hex_ignored_not_fatal(self):
        model = PhashHammingVisualSimilarity()
        score = model.similarity(SAME_PHASH, "zzzz-not-hex")
        assert 0.0 <= score <= 1.0

    def test_empty_hash_scores_zero(self):
        model = PhashHammingVisualSimilarity()
        assert model.similarity("", SAME_PHASH) == 0.0


class TestTokenIdentitySimilarity:
    def test_identical_name_scores_one(self):
        model = TokenIdentitySimilarity()
        assert model.similarity("Acme Corp", "Acme Corp") == 1.0

    def test_punctuation_and_case_noise_tolerated(self):
        model = TokenIdentitySimilarity()
        score = model.similarity("Acme Corp", "@acme_corp")
        assert score >= 0.5

    def test_different_name_scores_below_half(self):
        model = TokenIdentitySimilarity()
        assert model.similarity("Acme Corp", "Completely Different Org") < 0.5

    def test_empty_input_scores_zero(self):
        model = TokenIdentitySimilarity()
        assert model.similarity("", "Acme Corp") == 0.0


class TestModelRegistry:
    def test_default_settings_build_protocol_conformant_models(self, settings):
        model_set = build_model_set(settings)
        assert isinstance(model_set.text, TextSimilarityModel)
        assert isinstance(model_set.visual, VisualSimilarityModel)
        assert isinstance(model_set.identity, IdentitySimilarityModel)

    def test_version_string_composes_model_names(self, settings):
        model_set = build_model_set(settings)
        assert model_set.version_string == (
            "char_ngram_tfidf@1.0+phash_hamming@1.0+token_similarity@1.0"
        )

    def test_unknown_model_fails_at_startup_not_mid_analysis(self):
        settings = Settings(text_model="does_not_exist", _env_file=None)
        with pytest.raises(ModelUnavailableError) as excinfo:
            build_model_set(settings)
        assert excinfo.value.details["model_name"] == "does_not_exist"

    def test_model_set_is_frozen(self, settings):
        model_set = build_model_set(settings)
        with pytest.raises(Exception):
            model_set.text = CharNGramTextSimilarity()  # type: ignore[misc]
